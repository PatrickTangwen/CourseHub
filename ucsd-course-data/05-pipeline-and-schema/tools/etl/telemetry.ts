/**
 * OpenTelemetry instrumentation for the ETL refresh orchestrator.
 *
 * The pipeline code always records spans through the @opentelemetry/api
 * no-op-by-default tracer. A real exporter is registered only when the
 * standard OTEL_EXPORTER_OTLP_ENDPOINT environment variable is set, so
 * unattended runs can ship traces while local runs stay dependency-free.
 */

import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

const TRACER_NAME = 'coursetable-etl';
const SERVICE_NAME = 'coursetable-etl';

/** Run `fn` inside an active span, recording failure before rethrowing. */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        const value = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
}

/**
 * Register an OTLP trace exporter when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Returns a shutdown function that flushes pending spans; a no-op when no
 * endpoint is configured.
 */
export async function startEtlTelemetry(): Promise<() => Promise<void>> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return async () => {};

  const [sdkTraceNode, otlpHttp, resources] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
  ]);
  const provider = new sdkTraceNode.NodeTracerProvider({
    resource: resources.resourceFromAttributes({
      'service.name': SERVICE_NAME,
    }),
    spanProcessors: [
      new sdkTraceNode.BatchSpanProcessor(new otlpHttp.OTLPTraceExporter()),
    ],
  });
  provider.register();
  return () => provider.shutdown();
}
