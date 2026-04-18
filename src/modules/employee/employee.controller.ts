import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { EmployeeService } from './employee.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
// Import the class as a runtime DI token. We do NOT `imports: [CompanyModule]`
// in EmployeeModule, so there's no module-level cycle — only a file-level
// dependency. CompanyModule is expected to be registered globally or loaded
// before EmployeeModule in AppModule, and `strict: false` lets us resolve
// across modules.
import { InviteTokenService } from '../company/invite-token.service';

type JwtUser = { id: string; telegramId: string };

@UseGuards(AuthGuard('jwt'))
@Controller('employees')
export class EmployeeController {
  private readonly logger = new Logger(EmployeeController.name);

  constructor(
    private readonly employeeService: EmployeeService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * List my Employee records — one per company I belong to.
   */
  @Get('me')
  async listMine(@Req() req: Request) {
    const user = this.requireUser(req);
    return this.employeeService.myEmployees(user.id);
  }

  /**
   * My Employee record in a specific company, enriched with derived stats.
   * Placed before the generic `/:employeeId` route so the `me/:companyId`
   * path is matched first by Nest's router.
   */
  @Get('me/:companyId')
  async getMineInCompany(@Req() req: Request, @Param('companyId') companyId: string) {
    const user = this.requireUser(req);
    return this.employeeService.getMyEmployee(user.id, companyId);
  }

  /**
   * Accept a company invite token. Creates the Employee row and consumes the
   * token. InviteTokenService lives in CompanyModule; we resolve it via
   * ModuleRef to avoid an import cycle.
   */
  @Post('accept-invite')
  @HttpCode(HttpStatus.CREATED)
  async acceptInvite(@Req() req: Request, @Body() dto: AcceptInviteDto) {
    const user = this.requireUser(req);

    const inviteTokens = this.moduleRef.get(InviteTokenService, {
      strict: false,
    });

    const claim = await inviteTokens.consume(dto.token, user.id);
    if (!claim) {
      throw new UnauthorizedException('Invite token is invalid or expired');
    }

    const created = await this.employeeService.createFromInvite({
      userId: user.id,
      companyId: claim.companyId,
      role: claim.role as never,
      position: claim.position ?? null,
      // Prisma `Decimal` doesn't satisfy the service's `string | number | null`
      // signature directly; stringify so downstream Prisma calls still round-trip.
      monthlySalary: claim.monthlySalary ? claim.monthlySalary.toString() : null,
      hourlyRate: claim.hourlyRate ? claim.hourlyRate.toString() : null,
    });

    this.logger.log(
      `accept-invite success userId=${user.id} companyId=${claim.companyId} employeeId=${created.id}`,
    );

    // Re-read through the service so the response shape matches getMyEmployee.
    return this.employeeService.getMyEmployee(user.id, claim.companyId);
  }

  /**
   * Admin view of any employee. Service enforces OWNER/MANAGER membership in
   * the same company as the target employee.
   */
  @Get(':employeeId')
  async adminGet(@Req() req: Request, @Param('employeeId') employeeId: string) {
    const user = this.requireUser(req);
    return this.employeeService.adminGet(employeeId, user.id);
  }

  // ----- internals -----

  private requireUser(req: Request): JwtUser {
    const user = req.user as JwtUser | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated user missing');
    }
    return user;
  }
}
