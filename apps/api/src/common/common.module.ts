import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { ProblemDetailsFilter } from './problem-details.filter.js';
import { createValidationPipe } from './validation.pipe.js';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
