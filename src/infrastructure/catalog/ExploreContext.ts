import {z} from 'zod';

export const exploreColumnRoleSchema = z.enum([
  'identifier',
  'label',
  'category',
  'measure',
  'date',
  'year',
  'geometry',
  'municipality',
  'unknown'
]);

export const exploreChartTypeSchema = z.enum(['bar', 'line', 'scatter', 'histogram', 'pie', 'donut']);

export const exploreChartConfigSchema = z.object({
  type: exploreChartTypeSchema,
  x: z.string().optional(),
  y: z.string().optional(),
  color: z.string().optional(),
  title: z.string().optional()
});

export const exploreColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean().optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  example: z.string().optional(),
  roles: z.array(exploreColumnRoleSchema)
});

export const exploreTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  parquetUrl: z.string(),
  sizeBytes: z.number().optional(),
  rowCountEstimate: z.number().optional(),
  primary: z.boolean(),
  columns: z.array(exploreColumnSchema)
});

export const exploreRecipeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  tableId: z.string(),
  category: z.enum(['preview', 'profile', 'quality', 'category', 'numeric', 'time', 'custom']),
  sql: z.string(),
  preferredChart: exploreChartConfigSchema.optional()
});

export const exploreExecutionSchema = z.object({
  engine: z.literal('duckdb-wasm'),
  mode: z.literal('browser-local'),
  maxPreviewRows: z.number(),
  maxResultRows: z.number(),
  queryTimeoutMs: z.number()
});

export const exploreCatalogDatabaseSchema = z.object({
  url: z.string(),
  database: z.string(),
  schema: z.string()
});

export const exploreRLaboratorySchema = z.object({
  dataFrameName: z.literal('daten'),
  runtimeBaseUrl: z.string(),
  packageRepoUrl: z.string(),
  packages: z.array(z.string()),
  recommendedRows: z.number(),
  warningRows: z.number(),
  hardRows: z.number(),
  plotWidth: z.number(),
  plotHeight: z.number()
});

export const exploreContextSchema = z.object({
  version: z.literal(4),
  datasetId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  canonicalUrl: z.string(),
  updatedAt: z.string().optional(),
  license: z.string().optional(),
  execution: exploreExecutionSchema,
  catalogDatabase: exploreCatalogDatabaseSchema,
  tables: z.array(exploreTableSchema),
  recipes: z.array(exploreRecipeSchema),
  chartsEnabled: z.boolean(),
  webREnabled: z.boolean(),
  rLaboratory: exploreRLaboratorySchema
});

export type ExploreColumnRole = z.infer<typeof exploreColumnRoleSchema>;
export type ExploreChartConfigDto = z.infer<typeof exploreChartConfigSchema>;
export type ExploreColumnDto = z.infer<typeof exploreColumnSchema>;
export type ExploreTableDto = z.infer<typeof exploreTableSchema>;
export type ExploreRecipeDto = z.infer<typeof exploreRecipeSchema>;
export type ExploreExecutionDto = z.infer<typeof exploreExecutionSchema>;
export type ExploreCatalogDatabaseDto = z.infer<typeof exploreCatalogDatabaseSchema>;
export type ExploreRLaboratoryDto = z.infer<typeof exploreRLaboratorySchema>;
export type ExploreContextDto = z.infer<typeof exploreContextSchema>;

export function parseExploreContext(rawJson: string): ExploreContextDto {
  const parsed: unknown = JSON.parse(rawJson);
  return exploreContextSchema.parse(parsed);
}
