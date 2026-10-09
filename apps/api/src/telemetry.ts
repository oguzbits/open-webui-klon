import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const SERVICE_NAME = 'owui-api';

/** Returns undefined when no OTLP endpoint is configured: telemetry is then completely off. */
export function createTelemetrySdk(endpoint: string | undefined): NodeSDK | undefined {
  if (endpoint === undefined) return undefined;
  const base = endpoint.replace(/\/$/, '');
  return new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    // The HTTP instrumentation records request count, errors and duration (RED) as metrics.
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Health probes would fill every trace backend with noise.
        ignoreIncomingRequestHook: (request) => request.url?.startsWith('/api/health/') ?? false,
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new PinoInstrumentation(),
    ],
  });
}
