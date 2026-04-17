import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

import { PrismaService } from '@/common/prisma.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { RATE_LIMITS } from '@/common/throttle/throttle.constants';
import { CheckinService } from './checkin.service';
import { QrService } from './qr.service';
import { SseHub } from './sse.helper';
import { ScanQrDto } from './dto/scan-qr.dto';
import { ManualCheckinDto } from './dto/manual-checkin.dto';

/** JWT payload shape after JwtStrategy.validate. */
type JwtUser = { id: string; telegramId: string };

/** SSE heartbeat interval. Keeps intermediaries from idling the connection. */
const HEARTBEAT_MS = 10_000;

@ApiTags('checkin')
@Controller('checkin')
export class CheckinController {
  private readonly logger = new Logger(CheckinController.name);

  constructor(
    private readonly checkinService: CheckinService,
    private readonly qrService: QrService,
    private readonly sse: SseHub,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /checkin/scan — employee submits a scanned token
  // ---------------------------------------------------------------------------
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @Throttle({ default: RATE_LIMITS.CHECKIN_SCAN })
  @Post('scan')
  @ApiOperation({
    summary: 'Submit a scanned QR token',
    description:
      'Employee posts the token from the rotating office QR code; the service records a check-in.',
  })
  @ApiResponse({ status: 201, description: 'Check-in recorded' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async scan(@CurrentUser() user: JwtUser, @Body() dto: ScanQrDto) {
    if (!user?.id) throw new UnauthorizedException();
    return this.checkinService.scan(user.id, dto);
  }

  // ---------------------------------------------------------------------------
  // GET /checkin/qr/:companyId/current — for the office display
  //
  // Two authentication paths are accepted:
  //   1. A regular JWT belonging to an employee of the company.
  //   2. An X-Display-Key header matching the configured per-company key —
  //      used by unattended office screens that can't run Telegram login.
  // ---------------------------------------------------------------------------
  @Public()
  @Get('qr/:companyId/current')
  @ApiOperation({
    summary: 'Current rotating QR token for a company',
    description:
      'Accepts either an X-Display-Key header (for office screens) or a Bearer JWT belonging to an employee of the company.',
  })
  @ApiHeader({ name: 'X-Display-Key', required: false })
  @ApiResponse({ status: 200, description: 'Current token returned' })
  @ApiResponse({ status: 401, description: 'No valid display key or JWT' })
  async currentQr(
    @Param('companyId') companyId: string,
    @Headers('x-display-key') displayKey: string | undefined,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    await this.authorizeDisplayOrEmployee(companyId, displayKey, authHeader);
    return this.qrService.currentForCompany(companyId);
  }

  // ---------------------------------------------------------------------------
  // GET /checkin/qr/:companyId/stream — SSE live rotation feed
  //
  // Uses the same dual-auth rule as /current. Emits the latest token on
  // connect (via ReplaySubject(1)) and every subsequent rotation; sends a
  // named "ping" event every 10s so proxies don't kill the connection.
  // ---------------------------------------------------------------------------
  @Public()
  @Sse('qr/:companyId/stream')
  @ApiOperation({
    summary: 'SSE live feed of rotating QR tokens',
    description:
      'Server-Sent Events stream emitting the current token and every rotation. Same dual-auth (display key or employee JWT) as /current.',
  })
  @ApiHeader({ name: 'X-Display-Key', required: false })
  @ApiResponse({ status: 200, description: 'Event stream opened' })
  @ApiResponse({ status: 401, description: 'No valid display key or JWT' })
  async stream(
    @Param('companyId') companyId: string,
    @Headers('x-display-key') displayKey: string | undefined,
    @Headers('authorization') authHeader: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    await this.authorizeDisplayOrEmployee(companyId, displayKey, authHeader);

    // Prime the stream: ensure there's a current token so new subscribers
    // don't wait up to 30s for the first message.
    await this.qrService.currentForCompany(companyId);

    const tokens$ = this.sse.stream(companyId).pipe(
      map((payload): MessageEvent => ({ data: payload })),
    );

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { t: Date.now() } })),
    );

    return merge(tokens$, heartbeat$);
  }

  // ---------------------------------------------------------------------------
  // GET /checkin/history?companyId=... — my check-ins for current month
  // ---------------------------------------------------------------------------
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @Get('history')
  @ApiOperation({ summary: 'Caller check-in history for the current month' })
  @ApiResponse({ status: 200, description: 'List of check-ins' })
  @ApiResponse({ status: 400, description: 'companyId query param missing' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  async history(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string,
  ) {
    if (!user?.id) throw new UnauthorizedException();
    if (!companyId) {
      throw new BadRequestException('companyId query parameter is required');
    }
    return this.checkinService.listMyMonth(user.id, companyId);
  }

  // ---------------------------------------------------------------------------
  // POST /checkin/manual — OWNER/MANAGER creates a check-in on someone's behalf
  //
  // The target employee's companyId is resolved inside the service; this
  // endpoint simply needs a caller with an employee row. The service
  // enforces role + same-company constraints.
  // ---------------------------------------------------------------------------
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @Post('manual')
  @ApiOperation({
    summary: 'Manually record a check-in for another employee (OWNER/MANAGER)',
  })
  @ApiResponse({ status: 201, description: 'Manual check-in created' })
  @ApiResponse({ status: 400, description: 'Target employee not found' })
  @ApiResponse({ status: 403, description: 'Caller is not a member or lacks role' })
  async manual(
    @CurrentUser() user: JwtUser,
    @Body() dto: ManualCheckinDto,
  ) {
    if (!user?.id) throw new UnauthorizedException();

    // Resolve the caller's role within the target employee's company. We
    // look it up here so the controller can fail fast before hitting the
    // service; the service re-validates defensively.
    const target = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { companyId: true },
    });
    if (!target) {
      throw new BadRequestException('employeeId does not exist');
    }
    const actor = await this.prisma.employee.findUnique({
      where: {
        userId_companyId: { userId: user.id, companyId: target.companyId },
      },
      select: { role: true },
    });
    if (!actor) {
      throw new ForbiddenException('You are not a member of that company');
    }

    return this.checkinService.manualCreate(user.id, actor.role, dto);
  }

  // ---------------------------------------------------------------------------
  // Dual auth helper for display endpoints
  // ---------------------------------------------------------------------------

  /**
   * Validate either:
   *   - an `X-Display-Key` header matching the configured key for this
   *     company (DISPLAY_KEYS env, JSON map of companyId -> key), or
   *   - a Bearer JWT whose user is an employee of this company.
   */
  private async authorizeDisplayOrEmployee(
    companyId: string,
    displayKey: string | undefined,
    authHeader: string | undefined,
  ): Promise<void> {
    if (displayKey && this.isValidDisplayKey(companyId, displayKey)) {
      return;
    }

    // Fall back to JWT-bearer validation. We do this manually because the
    // route is marked @Public (so office displays with only a display key
    // can reach the handler without being blocked by JwtAuthGuard).
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const userId = await this.resolveUserIdFromBearer(token);
      if (userId) {
        const employee = await this.prisma.employee.findUnique({
          where: { userId_companyId: { userId, companyId } },
          select: { id: true },
        });
        if (employee) return;
      }
    }

    throw new UnauthorizedException(
      'Display key or employee JWT required for this company',
    );
  }

  private isValidDisplayKey(companyId: string, provided: string): boolean {
    const raw = this.config.get<string>('DISPLAY_KEYS');
    if (!raw) return false;
    let map: Record<string, string>;
    try {
      map = JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      this.logger.error(`DISPLAY_KEYS is not valid JSON: ${String(err)}`);
      return false;
    }
    const expected = map[companyId];
    if (!expected || typeof expected !== 'string') return false;
    // constant-time compare to avoid timing oracles on the display key
    if (expected.length !== provided.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * Verify a bearer JWT without going through Passport (the route is Public).
   * Returns the user id on success, or null on any failure.
   */
  private async resolveUserIdFromBearer(token: string): Promise<string | null> {
    try {
      const secret = this.config.get<string>('JWT_ACCESS_SECRET');
      if (!secret) return null;
      const decoded = this.jwt.verify<{ sub?: string }>(token, { secret });
      return decoded?.sub ?? null;
    } catch {
      return null;
    }
  }
}
