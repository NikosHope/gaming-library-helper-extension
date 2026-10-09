export function evaluateAudit(audit, exceptions, today = new Date().toISOString().slice(0, 10)) {
  if (!audit.metadata?.vulnerabilities || !audit.advisories || audit.error)
    throw new Error('Incomplete dependency audit; refusing to treat it as clean');
  const failures = [];
  const accepted = [];
  for (const exception of exceptions) {
    if (
      !exception.reason ||
      !/^\d{4}-\d{2}-\d{2}$/.test(exception.expires) ||
      exception.expires <= today
    )
      failures.push(`Expired or invalid exception: ${exception.advisory}`);
  }
  for (const advisory of Object.values(audit.advisories)) {
    const exception = exceptions.find((item) => item.advisory === advisory.github_advisory_id);
    const findings = advisory.findings ?? [];
    const permitted =
      exception &&
      exception.expires > today &&
      exception.module === advisory.module_name &&
      findings.length > 0 &&
      findings.every(
        (finding) =>
          finding.dev === true &&
          finding.version === exception.version &&
          finding.paths.length > 0 &&
          finding.paths.every((path) => exception.paths.includes(path)),
      );
    if (permitted)
      accepted.push(
        `${advisory.github_advisory_id}: ${advisory.module_name}, development-only exception until ${exception.expires}`,
      );
    else if (['high', 'critical'].includes(advisory.severity))
      failures.push(
        `${advisory.github_advisory_id}: ${advisory.module_name} (${advisory.severity})`,
      );
  }
  return { failures, accepted };
}
