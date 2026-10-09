import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuditAction } from './audit-action.js';
import { AuditLog } from './audit-log.entity.js';

export interface AuditEvent {
  actorId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repository: Repository<AuditLog>) {}

  async record(event: AuditEvent): Promise<void> {
    await this.repository.save(
      this.repository.create({
        actorId: event.actorId ?? null,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: event.requestId ?? null,
        metadata: event.metadata ?? {},
      })
    );
  }
}
