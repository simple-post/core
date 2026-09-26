import {
  type Assignment,
  assignmentKey,
  signAssignment,
  verifyAssignment,
  EXPERIMENT_COOKIE,
} from "../lib/experiments/contract";
import { buildExperimentReport, type ExperimentAccount, type Exposure } from "../lib/experiments/report";
import { signupExperiment } from "../lib/experiments/signup";
const DAY = 86_400_000;
const date = (days: number) => new Date(Date.UTC(2026, 9, 1) + days * DAY);
const key = "a".repeat(64);
const exposure: Exposure = { id: key, experimentId: "homepage_workflow_v1", variant: "a", exposedAt: date(0) };
const account = (days = 1): ExperimentAccount => ({
  createdAt: date(days),
  experimentAttribution: JSON.stringify({
    version: 1,
    assignmentId: key,
    experimentId: exposure.experimentId,
    variant: "a",
  }),
  experimentMilestone: { firstConnectedAt: date(2), firstPublishedAt: date(3) },
  firstPayment: { paidAt: date(10), amountPaid: 1000 },
});
test("cohorts mature at 7/14/30 days and use exposures as denominators", () => {
  const build = (days: number) => buildExperimentReport([exposure], [account()], date(days)).rows[0];
  expect(build(6.99)).toMatchObject({ exposed: 1, mature7d: 0, signups7d: 0, pending7d: 1, observedSignups7d: 1 });
  expect(build(7)).toMatchObject({ mature7d: 1, signups7d: 1, mature14d: 0, activated: 0 });
  expect(build(14)).toMatchObject({ mature14d: 1, connected: 1, activated: 1, mature30d: 0, paid: 0 });
  expect(build(30)).toMatchObject({ mature30d: 1, paid: 1 });
});
test("boundary signups count once; late, pre-exposure and unmatched accounts never count", () => {
  const result = buildExperimentReport(
    [exposure],
    [account(7), account(7), account(7.001), account(-1), { ...account(), experimentAttribution: null }],
    date(31),
  );
  expect(result).toMatchObject({ duplicateSignups: 1, lateSignups: 1, unmatched: 2 });
  expect(result.rows[0]).toMatchObject({ signups7d: 1, connected: 0, activated: 0 });
  expect(buildExperimentReport([], [account()], date(31)).rows[0].signups7d).toBe(0);
});
test("excludes wrong-arm matches, unpaid invoices, and out-of-window activation/payment", () => {
  const a = account();
  a.firstPayment!.amountPaid = 0;
  a.experimentMilestone!.firstPublishedAt = date(9);
  expect(buildExperimentReport([exposure], [a], date(31)).rows[0]).toMatchObject({ paid: 0, activated: 0 });
  a.firstPayment = { amountPaid: 1000, paidAt: date(30.001) };
  expect(buildExperimentReport([exposure], [a], date(31)).rows[0].paid).toBe(0);
  a.experimentAttribution = a.experimentAttribution!.replace('"variant":"a"', '"variant":"b"');
  expect(buildExperimentReport([exposure], [a], date(31)).rows[0].signups7d).toBe(0);
});
test("flags large 50/50 sample-ratio mismatches independently of conversion", () => {
  const exposures = Array.from({ length: 30 }, (_, index) => ({ ...exposure, id: String(index) }));
  expect(buildExperimentReport(exposures, [], date(31)).sampleRatioMismatch).toBe(true);
  exposures.forEach((e, index) => {
    if (index % 2) e.variant = "b";
  });
  expect(buildExperimentReport(exposures, [], date(31)).sampleRatioMismatch).toBe(false);
});
test("auth reads only valid signed cookies, honors opt-out, and retains closed-test signup linkage", () => {
  const secret = "test-only-signing-secret-not-production";
  process.env.HOMEPAGE_EXPERIMENT_SECRET = secret;
  const now = Date.now();
  const assignment: Assignment = {
    version: 1,
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    experimentId: "homepage_workflow_v1",
    variant: "b",
    issuedAt: now - 10_000,
    enrollmentEndsAt: now - 1000,
  };
  const token = signAssignment(assignment, secret);
  const headers = new Headers({ cookie: `${EXPERIMENT_COOKIE}=${token}` });
  expect(signupExperiment(headers)).toEqual({
    version: 1,
    assignmentId: assignmentKey(assignment),
    experimentId: assignment.experimentId,
    variant: "b",
  });
  expect(verifyAssignment(token, secret + "x")).toBeNull();
  headers.set("sec-gpc", "1");
  expect(signupExperiment(headers)).toBeNull();
  expect(signupExperiment(new Headers({ cookie: `${EXPERIMENT_COOKIE}={"variant":"a"}` }))).toBeNull();
  delete process.env.HOMEPAGE_EXPERIMENT_SECRET;
});
