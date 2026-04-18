import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '@/common/prisma.service';

/**
 * Ensures the authenticated caller is an OWNER or MANAGER employee of the
 * company referenced by the `:companyId` route param. Must run *after* the
 * JWT guard so `req.user.id` is populated.
 */
@Injectable()
export class CompanyAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as { id?: string } | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const companyId = (req.params as Record<string, string>)?.companyId;
    if (!companyId) {
      throw new ForbiddenException('companyId route param is missing');
    }

    const membership = await this.prisma.employee.findFirst({
      where: {
        companyId,
        userId: user.id,
        role: { in: ['OWNER', 'MANAGER'] },
        status: 'ACTIVE',
      },
      select: { id: true, role: true },
    });

    if (!membership) {
      throw new ForbiddenException('Caller is not an OWNER or MANAGER of this company');
    }

    return true;
  }
}
