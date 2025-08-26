/**
 * GitHub repository statistics collector with enhanced metrics using Octokit SDK and GraphQL
 */

import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import type { MetricResult } from './types.js';
import * as core from '@actions/core';

const PlatformSettings = {
  name: 'GitHub',
}

export interface ParsedAsset {
  project: string;
  os: string;
  arch: string;
  format: string;
  variant: string;
  version: string;
  original: string;
}

const OS_MAP: Record<string, string> = {
  linux: 'linux',
  darwin: 'macos',
  mac: 'macos',
  macos: 'macos',
  windows: 'windows',
  win: 'windows',
  freebsd: 'freebsd',
};

const ARCHES = ['amd64', 'x64', 'arm64', 'armv6', '386', 'i386'] as const;
const FORMATS = ['zip','tar.gz','tar.bz2','tar.xz','deb','rpm','msi','exe','txt','yaml','yml','json'] as const;
const VARIANTS = ['docs','installer'] as const;

export function parseReleaseAsset(filename: string): ParsedAsset {
  const original = filename;

  let project = '';
  let os = '';
  let arch = '';
  let format = '';
  let variant = '';
  let version = '';

  // Extract format (extension)
  const extRegex = new RegExp(`\\.(${FORMATS.join('|')})$`, 'i');
  const extMatch = filename.match(extRegex);
  format = extMatch ? extMatch[1].toLowerCase() : '';

  // Remove extension and normalize separators
  const nameWithoutExt = filename.replace(extRegex, '').replace(/[_-]/g, '.');

  const parts = nameWithoutExt.split('.');

  // API / special variants detection
  const apiIndex = parts.findIndex(p => p.toLowerCase() === 'api' || p.toLowerCase() === 'nerm' || p.toLowerCase() === 'beta');
  if (apiIndex >= 0) {
    project = parts.slice(0, apiIndex).join('.');
    let varMatch = parts.slice(apiIndex).join(' ');
    // Recognize versions for API specs: nerm, nerm v2025, v3, v2024, v2025, beta
    const nermMatch = varMatch.match(/nerm(?:\s+v\d{4})?/i);
    const vDigitMatch = varMatch.match(/v\d{1,4}\b/i);
    const betaMatch = varMatch.match(/\bbeta\b/i);
    const semverMatch = varMatch.match(/\d+\.\d+(?:\.\d+)?/);
    if (nermMatch) {
      version = nermMatch[0];
    } else if (vDigitMatch) {
      version = vDigitMatch[0];
    } else if (betaMatch) {
      version = 'beta';
    } else if (semverMatch) {
      version = semverMatch[0];
    }
    // Do not set OS to 'api' – leave blank for API specs
    os = '';
    arch = '';
    return { project, os, arch, format, variant, version, original };
  }

  // Version detection
  for (const part of parts) {
    const semverMatch = part.match(/^v?(\d+\.\d+(\.\d+)?)$/);
    if (semverMatch) {
      version = semverMatch[1];
      break;
    }
  }

  // OS detection
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (OS_MAP[lower]) os = OS_MAP[lower];
  }

  // Arch detection
  for (const part of parts) {
    const lower = part.toLowerCase();
    if ((ARCHES as readonly string[]).includes(lower)) arch = lower === 'x64' ? 'amd64' : lower;
  }

  // Variant detection
  for (const part of parts) {
    const lower = part.toLowerCase();
    if ((VARIANTS as readonly string[]).includes(lower)) variant = lower;
  }

  // Project is first part if not already set
  if (!project) project = parts[0];

  return { project, os, arch, format, variant, version, original };
}

// Build a grouping key from parsed asset parts, excluding version and
// collapsing YAML/JSON specs to the same group by omitting the format.
function buildParsedAssetKey(parsed: ParsedAsset): string {
  const parts: string[] = [];
  const project = parsed.project?.toLowerCase().trim();
  const os = parsed.os?.toLowerCase().trim();
  const arch = parsed.arch?.toLowerCase().trim();
  let variant = (parsed.variant || '').toLowerCase();
  if (parsed.version) {
    variant = variant.replace(parsed.version.toLowerCase(), '').replace(/[._-]+$/g, '').trim();
  }
  if (project) parts.push(project);
  if (os) parts.push(os);
  if (arch) parts.push(arch);
  if (variant) parts.push(variant);
  const fmt = (parsed.format || '').toLowerCase();
  if (fmt && fmt !== 'yaml' && fmt !== 'yml' && fmt !== 'json') {
    parts.push(fmt);
  }
  return parts.join('_');
}

// GraphQL query for basic repository data (without releases)
const REPOSITORY_BASIC_QUERY = `
  query RepositoryBasicData($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      name
      description
      homepageUrl
      stargazerCount
      forkCount
      watchers {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      primaryLanguage {
        name
      }
      diskUsage
      createdAt
      updatedAt
      pushedAt
      defaultBranchRef {
        name
      }
      repositoryTopics(first: 10) {
        nodes {
          topic {
            name
          }
        }
      }
      licenseInfo {
        name
        spdxId
      }
    }
  }
`;

// GraphQL query for releases with download data
const RELEASES_QUERY = `
  query RepositoryReleases($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      releases(first: $first, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          id
          tagName
          name
          description
          createdAt
          publishedAt
          releaseAssets(first: 100) {
            nodes {
              id
              name
              size
              downloadCount
              downloadUrl
            }
          }
        }
      }
    }
  }
`;

// Interface for basic repository data
interface GraphQLRepositoryBasicResponse {
  repository: {
    id: string;
    name: string;
    description: string | null;
    homepageUrl: string | null;
    stargazerCount: number;
    forkCount: number;
    watchers: { totalCount: number };
    openIssues: { totalCount: number };
    closedIssues: { totalCount: number };
    primaryLanguage: { name: string } | null;
    diskUsage: number;
    createdAt: string;
    updatedAt: string;
    pushedAt: string;
    defaultBranchRef: { name: string } | null;
    repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
    licenseInfo: { name: string; spdxId: string } | null;
  } | null;
}

// Interface for releases data
interface GraphQLReleasesResponse {
  repository: {
    releases: {
      nodes: Array<{
        id: string;
        tagName: string;
        name: string | null;
        description: string | null;
        createdAt: string;
        publishedAt: string | null;
        releaseAssets: {
          nodes: Array<{
            id: string;
            name: string;
            size: number;
            downloadCount: number;
            downloadUrl: string;
          } | null>;
        };
      } | null>;
    };
  } | null;
}

export async function collectGithub(repository: string): Promise<MetricResult> {
  try {
    const [owner, repo] = repository.split('/');

    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repository}. Expected "owner/repo"`);
    }

    // Initialize Octokit for REST API calls
    const token = core.getInput('github-token');
    const octokit = new Octokit({
      auth: token,
      userAgent: 'usage-statistics-tracker'
    });

    if (!token) {
      console.warn('No GitHub token provided. Using unauthenticated requests (rate limited).');
    }

    // Step 1: Fetch basic repository data using GraphQL
    let graphqlData: any = null;
    try {
      const graphqlClient = graphql.defaults({
        headers: { authorization: token ? `token ${token}` : undefined },
      });

      const basicResponse = await graphqlClient<GraphQLRepositoryBasicResponse>(REPOSITORY_BASIC_QUERY, {
        owner,
        name: repo
      });

      if (basicResponse.repository) {
        graphqlData = basicResponse.repository;
      }
    } catch (error) {
      console.warn(`Could not fetch GitHub GraphQL basic data for ${repository}:`, error);
    }

    // Step 2: Fetch releases data
    let totalReleaseDownloads = 0;
    let latestReleaseDownloads = 0;
    let releaseCount = 0;
    let downloadRange = [];
    let latestRelease = null;
    let assetTotalsByName: Record<string, number> = {};
    let assetReleaseSeries: Record<string, Array<{ tagName: string; day: string; downloads: number }>> = {};
    let assetAttributesByKey: Record<string, { project?: string; os?: string; arch?: string; format?: string; variant?: string; version?: string }> = {};
    // Additional breakdowns derived from parsed assets
    let assetTotalsByParsedKey: Record<string, number> = {};
    let totalsByOs: Record<string, number> = {};
    let totalsByArch: Record<string, number> = {};
    let totalsByFormat: Record<string, number> = {};
    let totalsByVariant: Record<string, number> = {};
    // Per-dimension per-release series for accurate trend charts
    let attributeReleaseSeries: Record<'os'|'arch'|'format'|'variant'|'version', Record<string, Record<string, number>>> = {
      os: {},
      arch: {},
      format: {},
      variant: {},
      version: {},
    };

    try {
      const graphqlClient = graphql.defaults({
        headers: { authorization: token ? `token ${token}` : undefined },
      });

      const releasesResponse = await graphqlClient<GraphQLReleasesResponse>(RELEASES_QUERY, {
        owner,
        name: repo,
        first: 100
      });

      if (releasesResponse.repository?.releases?.nodes) {
        const releases = releasesResponse.repository.releases.nodes.filter(Boolean);
        releaseCount = releases.length;

        for (const release of releases) {
          let releaseDownloads = 0;
          if (release?.releaseAssets?.nodes) {
            for (const asset of release.releaseAssets.nodes) {
              if (asset) {
                releaseDownloads += asset.downloadCount || 0;
                const rawAssetName = asset.name;
                const parsed = parseReleaseAsset(rawAssetName);
                const parsedKey = buildParsedAssetKey(parsed);
                const assetKey = parsedKey || rawAssetName.toLowerCase();
                const assetDownloads = asset.downloadCount || 0;

                // Skip checksum assets entirely
                if (parsed.variant && parsed.variant.toLowerCase().includes('checksum')) {
                  continue;
                }

                assetTotalsByName[assetKey] = (assetTotalsByName[assetKey] || 0) + assetDownloads;
                assetTotalsByParsedKey[parsedKey] = (assetTotalsByParsedKey[parsedKey] || 0) + assetDownloads;

                // Persist attribute mapping for charting by dimensions
                if (!assetAttributesByKey[assetKey]) {
                  assetAttributesByKey[assetKey] = {
                    project: parsed.project || undefined,
                    os: parsed.os || undefined,
                    arch: parsed.arch || undefined,
                    format: parsed.format || undefined,
                    variant: parsed.variant || undefined,
                    version: parsed.version || undefined,
                  };
                }

                if (parsed.os) totalsByOs[parsed.os] = (totalsByOs[parsed.os] || 0) + assetDownloads;
                if (parsed.arch) totalsByArch[parsed.arch] = (totalsByArch[parsed.arch] || 0) + assetDownloads;
                if (parsed.format) totalsByFormat[parsed.format] = (totalsByFormat[parsed.format] || 0) + assetDownloads;
                if (parsed.variant) totalsByVariant[parsed.variant] = (totalsByVariant[parsed.variant] || 0) + assetDownloads;

                // Build per-dimension series over releases
                const tag = release.tagName;
                if (parsed.os) {
                  if (!attributeReleaseSeries.os[parsed.os]) attributeReleaseSeries.os[parsed.os] = {};
                  attributeReleaseSeries.os[parsed.os][tag] = (attributeReleaseSeries.os[parsed.os][tag] || 0) + assetDownloads;
                }
                if (parsed.arch) {
                  if (!attributeReleaseSeries.arch[parsed.arch]) attributeReleaseSeries.arch[parsed.arch] = {};
                  attributeReleaseSeries.arch[parsed.arch][tag] = (attributeReleaseSeries.arch[parsed.arch][tag] || 0) + assetDownloads;
                }
                if (parsed.format) {
                  if (!attributeReleaseSeries.format[parsed.format]) attributeReleaseSeries.format[parsed.format] = {};
                  attributeReleaseSeries.format[parsed.format][tag] = (attributeReleaseSeries.format[parsed.format][tag] || 0) + assetDownloads;
                }
                if (parsed.variant) {
                  if (!attributeReleaseSeries.variant[parsed.variant]) attributeReleaseSeries.variant[parsed.variant] = {};
                  attributeReleaseSeries.variant[parsed.variant][tag] = (attributeReleaseSeries.variant[parsed.variant][tag] || 0) + assetDownloads;
                }
                if (parsed.version) {
                  const versionKey = parsed.version.toLowerCase();
                  if (!attributeReleaseSeries.version[versionKey]) attributeReleaseSeries.version[versionKey] = {};
                  attributeReleaseSeries.version[versionKey][tag] = (attributeReleaseSeries.version[versionKey][tag] || 0) + assetDownloads;
                }

                const day = release?.publishedAt || release?.createdAt;
                if (!assetReleaseSeries[assetKey]) {
                  assetReleaseSeries[assetKey] = [];
                }
                assetReleaseSeries[assetKey].push({
                  tagName: release.tagName,
                  day: day || '',
                  downloads: assetDownloads,
                });
              }
            }
          }
          totalReleaseDownloads += releaseDownloads;

          if (release && release === releases[0]) {
            latestReleaseDownloads = releaseDownloads;
            latestRelease = release.tagName;
          }

          if (release?.publishedAt) {
            downloadRange.push({
              day: release.publishedAt,
              downloads: releaseDownloads,
              tagName: release.tagName
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Could not fetch GitHub GraphQL releases data for ${repository}:`, error);
    }

    // Fallback REST API call
    let restData: any = null;
    try {
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      restData = repoData;
    } catch (error) {
      console.warn(`Could not fetch GitHub REST data for ${repository}:`, error);
    }

    const finalData = graphqlData || restData;
    if (!finalData) throw new Error('Could not fetch repository data from either GraphQL or REST API');

    // Repo traffic stats
    let viewsCount = 0;
    let uniqueVisitors = 0;
    let clonesCount = 0;
    if (token) {
      try {
        const { data: viewsData } = await octokit.repos.getViews({ owner, repo });
        if (viewsData) {
          viewsCount = viewsData.count || 0;
          uniqueVisitors = viewsData.uniques || 0;
        }
        const { data: clonesData } = await octokit.repos.getClones({ owner, repo });
        if (clonesData) {
          clonesCount = clonesData.count || 0;
        }
      } catch (error) {
        console.warn(`Could not fetch GitHub traffic data for ${repository}:`, error);
      }
    }

    // Repository age and last activity
    let repositoryAge = 0;
    if (finalData.createdAt) {
      const created = new Date(finalData.createdAt);
      const now = new Date();
      repositoryAge = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    }
    let lastActivity = 0;
    if (finalData.pushedAt) {
      const pushed = new Date(finalData.pushedAt);
      const now = new Date();
      lastActivity = Math.floor((now.getTime() - pushed.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      platform: PlatformSettings.name,
      name: repository,
      timestamp: new Date().toISOString(),
      metrics: {
        stars: finalData.stargazerCount || finalData.stargazers_count || 0,
        forks: finalData.forkCount || finalData.forks_count || 0,
        watchers: finalData.watchers?.totalCount || finalData.watchers_count || 0,
        totalIssues: finalData.openIssues?.totalCount + finalData.closedIssues?.totalCount || 0,
        openIssues: finalData.openIssues?.totalCount || 0,
        closedIssues: finalData.closedIssues?.totalCount || 0,
        language: finalData.primaryLanguage?.name || finalData.language || null,
        size: finalData.diskUsage || finalData.size || null,
        repositoryAge,
        lastActivity,
        releaseCount,
        totalReleaseDownloads,
        latestReleaseDownloads,
        viewsCount,
        uniqueVisitors,
        latestRelease,
        clonesCount,
        topics: finalData.repositoryTopics?.nodes?.length || finalData.topics?.length || 0,
        license: finalData.licenseInfo?.name || finalData.license?.name || null,
        defaultBranch: finalData.defaultBranchRef?.name || finalData.default_branch || null,
        downloadsTotal: totalReleaseDownloads || 0,
        downloadRange,
        assetTotalsByName,
        assetReleaseSeries,
        assetTotalsByParsedKey,
        totalsByOs,
        totalsByArch,
        totalsByFormat,
        totalsByVariant,
        attributeReleaseSeries,
        assetAttributesByKey,
      }
    };
  } catch (error) {
    return {
      platform: PlatformSettings.name,
      name: repository,
      timestamp: new Date().toISOString(),
      metrics: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function collectGithubBatch(repositories: string[]): Promise<MetricResult[]> {
  const results: Promise<MetricResult>[] = [];
  for (const repo of repositories) {
    results.push(collectGithub(repo));
  }
  return Promise.all(results);
}
