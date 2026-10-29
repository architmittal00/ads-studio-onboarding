// Meta reports an ad that is being processed as IN_PROCESS. This app treats that as
// ACTIVE everywhere (filters, badges, row actions), so every place that reads an
// effective_status runs it through here.
export function normalizeStatus(status) {
  return status === "IN_PROCESS" ? "ACTIVE" : status;
}
