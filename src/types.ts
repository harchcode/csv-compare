export type MainToWorkerMessage =
  | {
      type: "INIT";
      payload: {
        mode: "CSV_DIFF";
      };
    }
  | {
      type: "START";
      payload: {
        files: File[];
      };
    };

export type WorkerToMainMessage =
  | { type: "READY" }
  | { type: "PROGRESS"; payload: { processedRows: number; progress: number } }
  | { type: "COMPLETE"; payload: { totalCompared: number } }
  | { type: "ERROR"; payload: { message: string } };

export type DiffCluster = Record<string, number[]>;
export type DiffCell = string | DiffCluster;
export type DiffRow = DiffCell[];

export type DiffMeta = {
  fileCount: number;
  commonColumns: string[];
  comparedRows: number;
};

export type ColumnIndexMap = Record<string, number>;
