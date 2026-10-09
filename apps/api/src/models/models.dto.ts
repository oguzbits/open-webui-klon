import { ApiProperty } from '@nestjs/swagger';

import { PROVIDER_ERROR, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

export class ModelDto {
  /** `<connectionId>:<rawModelId>`; the chat sends this id back. */
  id!: string;
  name!: string;
  connectionId!: string;
  providerName!: string;
  @ApiProperty({ enum: Object.values(PROVIDER_TYPE) })
  providerType!: ProviderType;
}

export class UnavailableConnectionDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: Object.values(PROVIDER_ERROR) })
  reason!: ProviderErrorReason;
}

export class ModelListDto {
  @ApiProperty({ type: [ModelDto] })
  models!: ModelDto[];
  @ApiProperty({ type: [UnavailableConnectionDto] })
  unavailableConnections!: UnavailableConnectionDto[];
}

export class AdminModelDto {
  /** The provider's own id; `hiddenModelIds` of a connection holds these. */
  rawModelId!: string;
  name!: string;
  hidden!: boolean;
}

export class AdminModelListDto {
  @ApiProperty({ type: [AdminModelDto] })
  models!: AdminModelDto[];
}

export class ConnectionTestDto {
  ok!: boolean;
  modelCount!: number;
}
