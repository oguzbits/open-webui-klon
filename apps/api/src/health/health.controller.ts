import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthStatusDto } from './health.dto.js';
import { LifecycleService } from './lifecycle.service.js';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly lifecycle: LifecycleService
  ) {}

  @Get('live')
  @ApiOkResponse({ type: HealthStatusDto })
  live(): HealthStatusDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable or shutting down' })
  async ready(): Promise<HealthStatusDto> {
    if (this.lifecycle.isShuttingDown()) {
      throw new ServiceUnavailableException('Shutting down');
    }
    await this.health.check([() => this.database.pingCheck('database', { timeout: 1500 })]);
    return { status: 'ok' };
  }
}
