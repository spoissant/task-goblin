declare module "adf-to-md" {
  interface ConvertResult {
    result: string;
    warnings: string[];
  }
  export function convert(adf: unknown): ConvertResult;
  export function validate(adf: unknown): boolean;
}
