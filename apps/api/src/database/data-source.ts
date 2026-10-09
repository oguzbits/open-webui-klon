import { DataSource } from 'typeorm';

import { loadEnv } from '../config/env.js';
import { buildDataSourceOptions } from './data-source-options.js';

export default new DataSource(buildDataSourceOptions(loadEnv().DATABASE_URL));
