import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { TelegramVerifyDto } from './dto/telegram-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { BotLoginDto } from './dto/bot-login.dto';
import { RATE_LIMITS } from '@/common/throttle/throttle.constants';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

type JwtUser = { id: string; telegramId: string };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: RATE_LIMITS.AUTH.botLogin })
  @Post('telegram/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Telegram initData and issue tokens',
    description:
      'Validates the Telegram Mini App initData signature, upserts the user, and returns an access+refresh token pair.',
  })
  @ApiResponse({ status: 200, description: 'Access + refresh tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid Telegram signature' })
  async verifyTelegram(@Body() dto: TelegramVerifyDto) {
    const tgUser = await this.authService.verifyTelegramInitData(dto.initData);
    this.logger.log(`telegram verify success telegramId=${tgUser.id}`);
    const user = await this.authService.upsertUserFromTelegram(tgUser);
    return this.authService.issueTokens(user.id);
  }

  @Public()
  @Throttle({ default: RATE_LIMITS.AUTH.botLogin })
  @Post('telegram/bot-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a one-time bot code for tokens',
    description:
      'Used by the Telegram bot flow: consumes a short-lived one-time code and returns a token pair for the matched user.',
  })
  @ApiResponse({ status: 200, description: 'Token pair issued' })
  @ApiResponse({ status: 401, description: 'Invalid/expired OTC or user mismatch' })
  async botLogin(@Body() dto: BotLoginDto) {
    const telegramId = this.authService.consumeBotOneTimeCode(dto.oneTimeCode);
    if (!telegramId) {
      this.logger.warn(`bot-login invalid OTC userId=${dto.userId}`);
      throw new UnauthorizedException('Invalid or expired one-time code');
    }
    const user = await this.authService.getUserByTelegramId(telegramId);
    if (!user || user.id !== dto.userId) {
      this.logger.warn(`bot-login user mismatch telegramId=${telegramId}`);
      throw new UnauthorizedException('User mismatch');
    }
    this.logger.log(`bot-login success telegramId=${telegramId}`);
    return this.authService.issueTokens(user.id);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Trades a valid refresh token for a new access+refresh token pair.',
  })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or revoked' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async me(@Req() req: Request) {
    const jwtUser = req.user as JwtUser;
    const user = await this.authService.getUserById(jwtUser.id);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      firstName: user.firstName,
      lastName: user.lastName ?? null,
      username: user.username ?? null,
      phone: user.phone ?? null,
      avatarUrl: user.avatarUrl ?? null,
    };
  }
}
