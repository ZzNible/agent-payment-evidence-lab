import type { ScenarioOutput, VerificationReport } from "../domain/types.js";
import type { Reporter } from "../ports/reporter.js";

const statusMark = {
  PROVEN: "✅ PROVEN",
  NOT_PROVEN: "❌ NOT_PROVEN",
  UNKNOWN: "❔ UNKNOWN"
} as const;

export class MarkdownReporter implements Reporter {
  readonly extension = "md";

  render(report: VerificationReport, scenario?: ScenarioOutput): string {
    const title = scenario?.scenario ?? report.subject.interactionId;
    const claimRows = report.claims
      .map(claim => {
        const evidence = claim.evidence.length === 0 ? "—" : claim.evidence.map(code).join(", ");
        return `| ${code(claim.id)} | ${code(claim.type)} | ${statusMark[claim.status]} | ${code(claim.reasonCode)} | ${evidence} |`;
      })
      .join("\n");

    const limitations = report.claims
      .flatMap(claim => claim.limitations.map(limitation => ({ claim: claim.id, limitation })))
      .map(item => `- **${escapeMarkdown(item.claim)}:** ${escapeMarkdown(item.limitation)}`)
      .join("\n");

    return `# Evidence report: ${escapeMarkdown(title)}

> Evidence analysis only. This report does not authorize, release, retain, refund, or transfer funds.

## Result

| PROVEN | NOT_PROVEN | UNKNOWN | Economic action |
| ---: | ---: | ---: | --- |
| ${report.summary.proven} | ${report.summary.notProven} | ${report.summary.unknown} | **${report.economicAction}** |

## Input commitment

- Interaction: ${code(report.subject.interactionId)}
- Plan: ${code(report.subject.planId)} — ${code(report.inputs.planDigest)}
- Evidence bundle: ${code(report.subject.bundleId)} — ${code(report.inputs.bundleDigest)}
- Engine: ${code(`${report.engine.name}@${report.engine.version}`)}

## Claim-by-claim assessment

| Claim | Type | Status | Reason | Evidence |
| --- | --- | --- | --- | --- |
${claimRows}

## Limitations

${limitations.length === 0 ? "- No claim-specific limitations were recorded." : limitations}

## Interpretation

- **PROVEN** means the cited valid evidence implies the narrow proposition under the declared trust profile.
- **NOT_PROVEN** means enough evidence exists to evaluate the predicate and it was not satisfied. It does not by itself mean fraud.
- **UNKNOWN** means evidence, authority, independence, freshness, or scope is insufficient.
- A successful local settlement boundary is not an on-chain confirmation and does not mean real funds moved.
- HTTP success, schema conformance, source authentication, source independence, source authority, and commercial fulfilment are separate propositions.

**Economic action: ${report.economicAction}.**
`;
  }
}

function code(value: string): string {
  return `\`${value.replaceAll("|", "\\|").replaceAll("`", "\\`")}\``;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|");
}
