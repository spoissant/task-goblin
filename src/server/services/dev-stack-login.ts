/**
 * Sign-in links into the running alumni_connect dev stack (dev-stack.ts checks
 * the stack is up and the caller's before minting one).
 */
import { AppError } from "../lib/errors";
import { runShell, tailOutput } from "../lib/process";
import type { DevStackLoginAs, DevStackLoginLink } from "../../shared/types";

/**
 * Mints the same signed, single-use "log as" claim link the super-admin panel
 * hands out (LogAs::Grant, 10 minutes), from the CLI with the first super
 * admin as impersonator, so a browser signs in without a password or an
 * existing session. Defaults to the first confirmed member / admin of network
 * 1 (pandora). Prints one JSON line.
 */
const LOGIN_LINK_SCRIPT = `
as, id = ARGV
id = id.presence&.to_i
sa = SuperAdmin.order(:id).first or abort("No super admin in the local DB")
case as
when "member"
  subject = id ? User.kept.confirmed.find_by(id:) : Network.find(1).users.kept.confirmed.order(:id).first
  kind, impersonator = :user, sa
when "admin"
  subject = id ? SimpleAdmin.find_by(id:) : SimpleAdmin.where(network_id: 1).order(:id).first
  kind, impersonator = :simple_admin, sa
when "super_admin"
  subject = sa
  kind, impersonator = :super_admin_network, nil
else
  abort("Unknown role #{as}")
end
abort("No #{as} found#{" with id #{id}" if id}") unless subject
network = as == "super_admin" ? Network.find(1) : subject.network
routing = SharedRouting.routing_for(network)
destination_url = as == "member" ? routing.user_url(subject) : routing.backoffice_root_url
token = LogAs::Grant.generate(subject:, network:, kind:, destination_url:, impersonator:)
puts({url: routing.backoffice_log_as_claim_url(token:), subjectId: subject.id, name: subject.try(:name).presence || subject.email, networkId: network.id}.to_json)
`;
const LOGIN_LINK_TIMEOUT_MS = 3 * 60 * 1000;

/** A one-time sign-in link as a member, network admin or super admin, through rails runner from the main checkout. */
export async function mintLoginLink(mainPath: string, as: DevStackLoginAs, id: number | null): Promise<DevStackLoginLink> {
  const result = await runShell(mainPath, 'bin/dev dcx webapp bundle exec rails runner "$@"', {
    args: [LOGIN_LINK_SCRIPT, as, id === null ? "" : String(id)],
    timeoutMs: LOGIN_LINK_TIMEOUT_MS,
  });
  const line = result.exitCode === 0 ? result.stdout.split("\n").reverse().find((l) => l.startsWith("{")) : undefined;
  if (!line) {
    throw new AppError(`Could not mint a login link: ${tailOutput(result, 1000)}`, 500, "DEV_STACK_LOGIN_FAILED");
  }
  return JSON.parse(line) as DevStackLoginLink;
}
