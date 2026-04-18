import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '@/common/prisma.service';

export const COMPANY_ROLES_KEY = 'companyRoles';

/**
 * Decorator — restricts a route to employees holding one of the given roles
 * within the company identified by the `:id` route param (or `:companyId`).
 *
 * @example
 *   @RequireRole(EmployeeRole.OWNER, EmployeeRole.MANAGER)
 *   @Patch(':id')
 *   update() { ... }
 */
export const RequireRole = (...roles: EmployeeRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(COMPANY_ROLES_KEY, roles);

interface AuthedRequest {
  user?: { id: string } | null;
  params: Record<string, string>;
  employee?: {
    id: string;
    role: EmployeeRole;
    companyId: string;
    userId: string;
  };
}

@Injectable()
export class CompanyRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<EmployeeRole[] | undefined>(
      COMPANY_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequireRole applied — guard is a no-op.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const companyId = request.params?.id ?? request.params?.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Company identifier missing from route params');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { userId: user.id, companyId },
    });

    if (!employee) {
      throw new ForbiddenException('You are not a member of this company');
    }

    if (!requiredRoles.includes(employee.role)) {
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
    }

    // Stash the employee on the request so controllers/services can reuse it.
    request.employee = {
      id: employee.id,
      role: employee.role,
      companyId: employee.companyId,
      userId: employee.userId,
    };

    return true;
  }
}
