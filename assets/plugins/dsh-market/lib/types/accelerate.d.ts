/**
 * Routing a GitHub install through a region's proxy.
 *
 * pnpm does not fetch `github:owner/repo` with `git clone`; it resolves the
 * shortcut and downloads a tarball from codeload.github.com. That rules out
 * the usual `git config insteadOf` trick — there is no git command to
 * redirect — and leaves rewriting the target as the only lever.
 *
 * Worth it: measured from an unproxied mainland connection, that tarball
 * takes 85s direct and 4.8s through the proxy.
 *
 * Two properties have to survive the rewrite, and both were found the hard
 * way rather than assumed:
 *
 * - **The commit has to be pinned.** The profile reads each plugin's
 *   installed commit back out of the lockfile by matching a codeload URL
 *   ending in a 40-character SHA (src/profile.ts). A `HEAD` tarball installs
 *   perfectly and then reports no version forever. So this resolves the SHA
 *   first, and a rewrite that cannot get one does not happen.
 * - **Build-script approval has to keep matching.** `gitAllowBuildsKey`
 *   (src/sources.ts) derives its key from the repo, and now recognizes the
 *   proxied form too — a plugin does not become a different plugin because
 *   its bytes arrived by another route.
 *
 * Subpath entries are left alone. A `#path:` selector picks one directory
 * out of a repo, and a tarball URL has nowhere to say that; those installs
 * stay on the direct route rather than quietly installing the wrong thing.
 *
 * Every failure falls back to the original target. Acceleration is an
 * optimisation, and an optimisation that can fail an install is a bug.
 */
import { type Region } from './regions.ts';
/**
 * The commit `HEAD` points at, from git's own ref advertisement.
 *
 * This is the endpoint `git clone` reads before it fetches anything, and it
 * is the right one here for two measured reasons. It is not the REST API, so
 * it does not consume the 60-requests-per-hour unauthenticated quota that a
 * user installing a handful of plugins could plausibly exhaust. And it
 * survives the proxy: over five consecutive tries from an unproxied mainland
 * connection it answered 200 in ~1.2s every time, while the REST API through
 * the same proxy returned 200, 200, then 403 — a proxy that rate-limits the
 * API path would silently drop every install back to the slow route.
 *
 * The response is git's pkt-line format, whose first ref line carries
 * `<sha> HEAD\0<capabilities>`. Read with a pattern rather than a parser:
 * one 40-character hex string followed by `HEAD` is unambiguous in this
 * payload, and a length-prefix reader would be more code to get wrong.
 */
export declare function headCommit(repo: string, proxy: string | null, signal?: AbortSignal): Promise<string | null>;
/**
 * The current `HEAD` commit for a repo, on whichever route the region uses.
 *
 * Wraps the timeout so callers outside the install path — the build-script
 * approval below, which needs a commit-pinned key — do not each reinvent it.
 */
export declare function resolveHeadCommit(repo: string, region: Region, env?: NodeJS.ProcessEnv): Promise<string | null>;
/**
 * The install target to actually hand pnpm, given the region in force.
 *
 * @param target - what `installTargetFor` produced.
 * @param region - the download region.
 * @param env - environment, for the proxy override.
 * @returns a proxied commit-pinned tarball URL when every condition holds,
 *   otherwise `target` unchanged.
 */
export declare function acceleratedTarget(target: string, region: Region, env?: NodeJS.ProcessEnv): Promise<string>;
