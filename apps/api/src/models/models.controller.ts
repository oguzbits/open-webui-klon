import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ModelRegistryService } from './model-registry.service.js';
import { ModelListDto } from './models.dto.js';

/** Every signed-in user (not "pending"); the global guard closes the route for everybody else. */
@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(private readonly registry: ModelRegistryService) {}

  @Get()
  @ApiOkResponse({ type: ModelListDto })
  list(): Promise<ModelListDto> {
    return this.registry.list();
  }
}
