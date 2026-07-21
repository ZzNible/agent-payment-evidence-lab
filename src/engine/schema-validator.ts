import Ajv2020, {
  type ErrorObject,
  type Options,
  type ValidateFunction
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { readProjectFile } from "../security/project-files.js";

export type DocumentKind = "plan" | "bundle" | "report";

const schemaFiles: Record<DocumentKind, string> = {
  plan: "verification-plan.schema.json",
  bundle: "evidence-bundle.schema.json",
  report: "verification-report.schema.json"
};

interface AjvLike {
  compile(schema: object): ValidateFunction;
}

const AjvConstructor = Ajv2020 as unknown as new (options?: Options) => AjvLike;
const installFormats = addFormats as unknown as (ajv: AjvLike) => unknown;

let validatorsPromise: Promise<Record<DocumentKind, ValidateFunction>> | undefined;

export async function validateDocument(kind: DocumentKind, value: unknown): Promise<void> {
  const validators = await (validatorsPromise ??= loadValidators());
  const validator = validators[kind];
  if (!validator(value)) {
    throw new DocumentValidationError(kind, validator.errors ?? []);
  }
}

export class DocumentValidationError extends Error {
  constructor(
    readonly kind: DocumentKind,
    readonly validationErrors: ErrorObject[]
  ) {
    super(
      `${kind} document failed schema validation:\n${validationErrors
        .slice(0, 12)
        .map(formatError)
        .join("\n")}`
    );
    this.name = "DocumentValidationError";
  }
}

async function loadValidators(): Promise<Record<DocumentKind, ValidateFunction>> {
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  installFormats(ajv);
  const entries = await Promise.all(
    (Object.entries(schemaFiles) as [DocumentKind, string][]).map(async ([kind, filename]) => {
      const schema = JSON.parse(await readProjectFile(`schemas/${filename}`)) as object;
      return [kind, ajv.compile(schema)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<DocumentKind, ValidateFunction>;
}

function formatError(error: ErrorObject): string {
  const path = error.instancePath.length === 0 ? "/" : error.instancePath;
  return `- ${path}: ${error.message ?? error.keyword}`;
}
