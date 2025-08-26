import { mkdirSync, writeFileSync } from "fs";
import { Chart, registerables } from 'chart.js';
import { Canvas } from 'skia-canvas';
import semver from "semver";
// Register all Chart.js controllers
Chart.register(...registerables);
/**
 * Safely compare two version strings using semver
 * Falls back to string comparison if semver parsing fails
 */
function safeSemverCompare(a, b) {
    try {
        const cleanA = a.trim();
        const cleanB = b.trim();
        if (!semver.valid(cleanA) || !semver.valid(cleanB)) {
            return cleanA.localeCompare(cleanB);
        }
        return semver.compare(cleanA, cleanB);
    }
    catch {
        return a.trim().localeCompare(b.trim());
    }
}
/**
 * Prettify a normalized asset key for charts/summaries
 * Example: "sail|linux|amd64|yaml" -> "Sail / Linux / Amd64 / Yaml"
 */
function formatAssetLabel(key) {
    return key
        .split("|")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" / ");
}
export function formatGitHubSummary(summary, platformMetrics) {
    let totalStars = 0;
    let totalForks = 0;
    let totalWatchers = 0;
    let totalIssues = 0;
    let totalOpenIssues = 0;
    let totalClosedIssues = 0;
    let totalDownloads = 0;
    let totalReleases = 0;
    summary += `| Repository | Stars | Forks | Watchers | Open Issues | Closed Issues | Total Issues | Release Downloads | Releases | Latest Release | Language |\n`;
    summary += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
    for (const metric of platformMetrics) {
        const stars = metric.metrics?.stars || 0;
        const forks = metric.metrics?.forks || 0;
        const watchers = metric.metrics?.watchers || 0;
        const issues = metric.metrics?.totalIssues || 0;
        const openIssues = metric.metrics?.openIssues || 0;
        const closedIssues = metric.metrics?.closedIssues || 0;
        const downloads = metric.metrics?.totalReleaseDownloads || 0;
        const releases = metric.metrics?.releaseCount || 0;
        const latestRelease = metric.metrics?.latestRelease || 'N/A';
        const language = metric.metrics?.language || 'N/A';
        totalStars += stars;
        totalForks += forks;
        totalWatchers += watchers;
        totalIssues += issues;
        totalOpenIssues += openIssues;
        totalClosedIssues += closedIssues;
        totalDownloads += downloads;
        totalReleases += releases;
        summary += `| ${metric.name} | ${stars.toLocaleString()} | ${forks.toLocaleString()} | ${watchers.toLocaleString()} | ${openIssues.toLocaleString()} | ${closedIssues.toLocaleString()} | ${issues.toLocaleString()} | ${downloads.toLocaleString()} | ${releases.toLocaleString()} | ${latestRelease} | ${language} |\n`;
    }
    summary += `| **Total** | **${totalStars.toLocaleString()}** | **${totalForks.toLocaleString()}** | **${totalWatchers.toLocaleString()}** | **${totalOpenIssues.toLocaleString()}** | **${totalClosedIssues.toLocaleString()}** | **${totalIssues.toLocaleString()}** | **${totalDownloads.toLocaleString()}** | **${totalReleases.toLocaleString()}** | | |\n`;
    return summary;
}
export async function addRepoDetails(summary, metrics) {
    summary += `#### Repository Details:\n\n`;
    for (const metric of metrics) {
        summary += `**${metric.name}**:\n`;
        summary += `- Last Activity: ${metric.metrics?.lastActivity?.toLocaleString() || 0} days ago\n`;
        summary += `- Repository Age: ${metric.metrics?.repositoryAge?.toLocaleString() || 0} days\n`;
        summary += `- Release Count: ${metric.metrics?.releaseCount?.toLocaleString() || 0}\n`;
        summary += `- Total Release Downloads: ${metric.metrics?.totalReleaseDownloads?.toLocaleString() || 0}\n`;
        summary += `- Latest Release: ${metric.metrics?.latestRelease || 'N/A'}\n`;
        summary += `- Latest Release Downloads: ${metric.metrics?.latestReleaseDownloads?.toLocaleString() || 0}\n`;
        summary += `- Views: ${metric.metrics?.viewsCount?.toLocaleString() || 0}\n`;
        summary += `- Unique Visitors: ${metric.metrics?.uniqueVisitors?.toLocaleString() || 0}\n`;
        summary += `- Clones: ${metric.metrics?.clonesCount?.toLocaleString() || 0}\n`;
        // Include top assets using parsed grouping keys for better aggregation
        const assetTotalsByParsedKey = metric.metrics?.assetTotalsByParsedKey;
        if (assetTotalsByParsedKey && Object.keys(assetTotalsByParsedKey).length > 0) {
            const topAssets = Object.entries(assetTotalsByParsedKey)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            if (topAssets.length > 0) {
                summary += `- Top Assets (by downloads):\n`;
                for (const [assetName, count] of topAssets) {
                    summary += `  - ${assetName}: ${count.toLocaleString()}\n`;
                }
            }
        }
        // OS/Arch/Format/Variant breakdowns
        const totalsByOs = metric.metrics?.totalsByOs;
        const totalsByArch = metric.metrics?.totalsByArch;
        const totalsByFormat = metric.metrics?.totalsByFormat;
        const totalsByVariant = metric.metrics?.totalsByVariant;
        if (totalsByOs && Object.keys(totalsByOs).length > 0) {
            const ordered = Object.entries(totalsByOs).sort((a, b) => b[1] - a[1]).slice(0, 5);
            summary += `- OS Breakdown:\n`;
            for (const [k, v] of ordered)
                summary += `  - ${k}: ${v.toLocaleString()}\n`;
        }
        if (totalsByArch && Object.keys(totalsByArch).length > 0) {
            const ordered = Object.entries(totalsByArch).sort((a, b) => b[1] - a[1]).slice(0, 5);
            summary += `- Arch Breakdown:\n`;
            for (const [k, v] of ordered)
                summary += `  - ${k}: ${v.toLocaleString()}\n`;
        }
        if (totalsByFormat && Object.keys(totalsByFormat).length > 0) {
            const ordered = Object.entries(totalsByFormat).sort((a, b) => b[1] - a[1]).slice(0, 5);
            summary += `- Format Breakdown:\n`;
            for (const [k, v] of ordered)
                summary += `  - ${k}: ${v.toLocaleString()}\n`;
        }
        if (totalsByVariant && Object.keys(totalsByVariant).length > 0) {
            const ordered = Object.entries(totalsByVariant).sort((a, b) => b[1] - a[1]).slice(0, 5);
            summary += `- Variant Breakdown:\n`;
            for (const [k, v] of ordered)
                summary += `  - ${k}: ${v.toLocaleString()}\n`;
        }
        summary += `\n`;
    }
    summary += `\n\n`;
    const chatOutputPath = './charts/github';
    mkdirSync(chatOutputPath, { recursive: true });
    const svgOutputPathList = await createGitHubReleaseChart(metrics, chatOutputPath);
    for (const svgOutputPath of svgOutputPathList) {
        summary += `![${svgOutputPath}](${svgOutputPath})\n`;
    }
    return summary;
}
export async function createGitHubReleaseChart(platformMetrics, outputPath) {
    const svgOutputPathList = [];
    for (const metric of platformMetrics) {
        // Only create charts if there's download data
        if (metric.metrics?.downloadRange && metric.metrics.downloadRange.length > 0) {
            const svgOutputPath = await createDownloadsPerReleaseChart(metric, outputPath);
            svgOutputPathList.push(svgOutputPath);
            const svgOutputPathCumulative = await createCumulativeDownloadsChart(metric, outputPath);
            svgOutputPathList.push(svgOutputPathCumulative);
            // Create trend charts by dimensions if parsed attributes exist
            if (metric.metrics?.assetReleaseSeries && metric.metrics?.assetAttributesByKey) {
                const trends = await createParsedAttributeTrendCharts(metric, outputPath);
                svgOutputPathList.push(...trends);
            }
        }
    }
    return svgOutputPathList;
}
function groupByReleaseCumulative(releaseRange) {
    const releases = {};
    for (const release of releaseRange.sort((a, b) => safeSemverCompare(a.tagName || '0.0.0', b.tagName || '0.0.0'))) {
        if (!release.tagName)
            continue;
        if (!releases[release.tagName]) {
            releases[release.tagName] = { downloads: release.downloads, tagName: release.tagName };
        }
        else {
            releases[release.tagName].downloads += release.downloads;
        }
    }
    let cumulativeDownloads = 0;
    for (const release of Object.keys(releases).sort((a, b) => safeSemverCompare(a, b))) {
        cumulativeDownloads += releases[release].downloads;
        releases[release].downloads = cumulativeDownloads;
    }
    return releases;
}
export async function createDownloadsPerReleaseChart(metric, outputPath) {
    const downloadsRange = metric.metrics?.downloadRange || [];
    const svgOutputPath = `${outputPath}/${metric.name.replace('/', '-')}-release-downloads.svg`;
    const sortedReleases = downloadsRange.sort((a, b) => safeSemverCompare(a.tagName || '0.0.0', b.tagName || '0.0.0'));
    const canvas = new Canvas(1000, 800);
    const chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: sortedReleases.map((r) => r.tagName),
            datasets: [{
                    label: `${metric.name} Release Downloads`,
                    data: sortedReleases.map((r) => r.downloads),
                    backgroundColor: 'rgba(54, 162, 235, 0.8)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1,
                }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: `${metric.name} - Release Downloads`, font: { size: 16 } },
                legend: { display: true }
            },
            scales: {
                x: { title: { display: true, text: 'Release' } },
                y: { title: { display: true, text: 'Downloads' }, beginAtZero: true }
            }
        }
    });
    const svgBuffer = await canvas.toBuffer('svg', { matte: 'white' });
    writeFileSync(svgOutputPath, svgBuffer);
    chart.destroy();
    return svgOutputPath;
}
export async function createCumulativeDownloadsChart(metric, outputPath) {
    const downloadsRange = metric.metrics?.downloadRange || [];
    const svgOutputPath = `${outputPath}/${metric.name.replace('/', '-')}-cumulative-release-downloads.svg`;
    const groupedDownloads = groupByReleaseCumulative(downloadsRange);
    const semVerSortedReleases = Object.keys(groupedDownloads).sort((a, b) => safeSemverCompare(a, b));
    const canvas = new Canvas(1000, 800);
    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: semVerSortedReleases,
            datasets: [{
                    label: `${metric.name} Cumulative Downloads`,
                    data: semVerSortedReleases.map((release) => groupedDownloads[release].downloads),
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.1
                }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: `${metric.name} - Cumulative Release Downloads`, font: { size: 16 } },
                legend: { display: true }
            },
            scales: {
                x: { title: { display: true, text: 'Release' } },
                y: { title: { display: true, text: 'Downloads' }, beginAtZero: true }
            }
        }
    });
    const svgBuffer = await canvas.toBuffer('svg', { matte: 'white' });
    writeFileSync(svgOutputPath, svgBuffer);
    chart.destroy();
    return svgOutputPath;
}
export async function createParsedAttributeTrendCharts(metric, outputPath) {
    const outputPaths = [];
    const attrSeries = metric.metrics?.attributeReleaseSeries || { os: {}, arch: {}, format: {}, variant: {}, version: {} };
    const dims = ['os', 'arch', 'format', 'variant', 'version'];
    for (const dim of dims) {
        const groups = attrSeries[dim] || {};
        const groupNames = Object.keys(groups);
        if (groupNames.length === 0)
            continue;
        // Build union of release tags for this dim
        const allReleaseTags = Array.from(new Set(groupNames.flatMap(name => Object.keys(groups[name]))))
            .sort((a, b) => safeSemverCompare(a || '0.0.0', b || '0.0.0'));
        const svgOutputPath = `${outputPath}/${metric.name.replace('/', '-')}-trend-${dim}.svg`;
        const datasets = groupNames.map((name, idx) => {
            const colorHue = (idx * 53) % 360;
            const borderColor = `hsl(${colorHue}, 70%, 45%)`;
            const backgroundColor = `hsla(${colorHue}, 70%, 45%, 0.2)`;
            const byTag = groups[name];
            return {
                label: name,
                data: allReleaseTags.map(tag => byTag[tag] || 0),
                borderColor,
                backgroundColor,
                borderWidth: 2,
                fill: false,
                tension: 0.1
            };
        });
        const canvas = new Canvas(1200, 800);
        const chart = new Chart(canvas, {
            type: 'line',
            data: { labels: allReleaseTags, datasets },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: `${metric.name} - ${dim.toUpperCase()} Download Trends`, font: { size: 16 } },
                    legend: { display: true }
                },
                scales: {
                    x: { title: { display: true, text: 'Release Tag' } },
                    y: {
                        title: { display: true, text: 'Downloads' },
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        suggestedMin: 0,
                        suggestedMax: Math.max(10, ...datasets.map((ds) => Math.max(...ds.data)))
                    }
                }
            }
        });
        const svgBuffer = await canvas.toBuffer('svg', { matte: 'white' });
        writeFileSync(svgOutputPath, svgBuffer);
        chart.destroy();
        outputPaths.push(svgOutputPath);
    }
    return outputPaths;
}
export async function createAssetDownloadsAcrossReleasesChart(metric, outputPath) {
    const assetSeries = metric.metrics?.assetReleaseSeries || {};
    const svgOutputPath = `${outputPath}/${metric.name.replace('/', '-')}-asset-downloads-over-releases.svg`;
    const assetNames = Object.keys(assetSeries);
    if (assetNames.length === 0)
        return svgOutputPath;
    const allReleaseTagsSet = new Set();
    for (const name of assetNames) {
        for (const point of assetSeries[name]) {
            allReleaseTagsSet.add(point.tagName);
        }
    }
    const allReleaseTags = Array.from(allReleaseTagsSet).sort((a, b) => safeSemverCompare(a || '0.0.0', b || '0.0.0'));
    const datasets = assetNames.map((name, idx) => {
        const points = assetSeries[name];
        const byTag = {};
        for (const p of points) {
            byTag[p.tagName] = (byTag[p.tagName] || 0) + (p.downloads || 0);
        }
        const colorHue = (idx * 53) % 360;
        return {
            label: formatAssetLabel(name),
            data: allReleaseTags.map(tag => byTag[tag] || 0),
            borderColor: `hsl(${colorHue}, 70%, 45%)`,
            backgroundColor: `hsla(${colorHue}, 70%, 45%, 0.2)`,
            borderWidth: 2,
            fill: false,
            tension: 0.1
        };
    });
    const canvas = new Canvas(1200, 800);
    const chart = new Chart(canvas, {
        type: 'line',
        data: { labels: allReleaseTags, datasets },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: `${metric.name} - Asset Downloads Across Releases`, font: { size: 16 } },
                legend: { display: true }
            },
            scales: {
                x: { title: { display: true, text: 'Release Tag' } },
                y: { title: { display: true, text: 'Downloads' }, beginAtZero: true }
            }
        }
    });
    const svgBuffer = await canvas.toBuffer('svg', { matte: 'white' });
    writeFileSync(svgOutputPath, svgBuffer);
    chart.destroy();
    return svgOutputPath;
}
