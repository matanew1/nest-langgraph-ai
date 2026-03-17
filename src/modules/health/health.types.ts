export type DependencyStatus = 'ok' | 'error' | 'unavailable';
export type ReadinessStatus = 'ok' | 'unhealthy';
export type DependencyReportStatus = 'ok' | 'degraded' | 'unhealthy';

export interface LivenessResponse {
  status: 'ok';
  scope: 'liveness';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: ReadinessStatus;
  scope: 'readiness';
  details: {
    redis: DependencyStatus;
    qdrant: DependencyStatus;
  };
  timestamp: string;
}

export interface DependencyReportResponse {
  status: DependencyReportStatus;
  scope: 'dependencies';
  required: {
    redis: DependencyStatus;
    qdrant: DependencyStatus;
  };
  optional: {
    mistral: DependencyStatus;
    tavily: DependencyStatus;
  };
  timestamp: string;
}
