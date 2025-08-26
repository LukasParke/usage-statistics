import * as core from '@actions/core';
import { CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, BarController, BarElement } from 'chart.js';
import { readFile, writeFile } from 'fs/promises';
import type { MetricResult } from "./collectors/types.js";
import { addRepoDetails, formatGitHubSummary } from './summaries/github.js';
import { addNpmDetails, formatNpmSummary } from './summaries/npm.js';
import { formatPowerShellSummary, addPowerShellDetails } from './summaries/powershell.js';
import { addPypiDetails, addPypiCharts, formatPypiSummary } from './summaries/pypi.js';

Chart.register([
    CategoryScale,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    BarController,
    BarElement
]);

/**
 * Parse comma-separated inputs into arrays
 * @param input - The input string to parse
 * @returns An array of trimmed, non-empty items
 */
function parseCommaSeparatedInputs(input: string) {
    return input ? input.split(',').map(item => item.trim()).filter(item => item) : []
}

export function getInputs() {
    // Get all inputs from action.yml
    const npmPackages = core.getInput('npm-packages')
    const githubRepositories = core.getInput('github-repositories')
    const pypiPackages = core.getInput('pypi-packages')
    const powershellModules = core.getInput('powershell-modules')
    const jsonOutputPath = core.getInput('json-output-path')
    const updateReadme = core.getInput('update-readme').toLowerCase() === 'true'
    const commitMessage = core.getInput('commit-message')
    const readmePath = core.getInput('readme-path')

    return {
        npmPackages: parseCommaSeparatedInputs(npmPackages),
        githubRepositories: parseCommaSeparatedInputs(githubRepositories),
        pypiPackages: parseCommaSeparatedInputs(pypiPackages),
        powershellModules: parseCommaSeparatedInputs(powershellModules),
        jsonOutputPath,
        updateReadme,
        commitMessage,
        readmePath,
    }
}

const MetricsPlaceHolderRegex = /<!-- METRICS_START -->[\s\S]*<!-- METRICS_END -->/

function formatSummary(summary: string) {
    return `<!-- METRICS_START -->\n${summary}\n<!-- METRICS_END -->`
}

const PlatformMap = {
    "NPM": "JavaScript/TypeScript",
    "PyPI": "Python",
    "PowerShell Gallery": undefined,
    "GitHub": undefined,
}

export async function createSummary(metrics: MetricResult[]) {
    const platforms = metrics.map(metric => metric.platform).filter((value, index, self) => self.indexOf(value) === index)
    console.log(platforms)

    console.log(metrics)

    let summary = `# Usage Statistics
    
Last updated: ${new Date().toLocaleString()}

Below are stats from artifacts tracked across ${platforms.slice(0, -1).join(', ')} and ${platforms.slice(-1)}.
    
`

    for (const platform of platforms) {

        const platformMetrics = metrics.filter(metric => metric.platform === platform)
        const platformLanguage = PlatformMap[platform as keyof typeof PlatformMap]

        summary += `### ${platform}${platformLanguage ? ` (${platformLanguage})` : ''}: \n\n`

        switch (platform) {
            case "NPM":
                summary = formatNpmSummary(summary, platformMetrics)
                break;
            case "GitHub":
                summary = formatGitHubSummary(summary, platformMetrics)
            break;
            case "PyPI":
                summary = formatPypiSummary(summary, platformMetrics)
                break;  
            case "PowerShell":
                summary = formatPowerShellSummary(summary, platformMetrics)
                break;
            default:
                let platformDownloadTotal = 0
                summary += `| Package | Downloads |\n`
                summary += `| --- | --- |\n`
                for (const metric of platformMetrics) {
                    summary += `| ${metric.name} | ${metric.metrics?.downloadCount?.toLocaleString() || 0} |\n`
                    platformDownloadTotal += metric.metrics?.downloadCount || 0
                }
                summary += `| **Total** | **${platformDownloadTotal.toLocaleString()}** |\n`
                break;
        }

        summary += `\n`
        
        // Add detailed information for each platform
        switch (platform) {
            case "GitHub":
                summary = await addRepoDetails(summary, platformMetrics)
                break;
            case "PyPI":
                summary = addPypiDetails(summary, platformMetrics)
                summary = await addPypiCharts(summary, platformMetrics)
                break;
            case "NPM":
                summary = await addNpmDetails(summary, platformMetrics)
                break;
            case "PowerShell":
                summary = await addPowerShellDetails(summary, platformMetrics)
                break;
            default:
                break;
        }

        summary += '\n'
    }

    return summary
}

export async function updateRepositoryReadme(metrics: MetricResult[], readmePath: string) {
    const currentReadme = await readFile(readmePath, 'utf8')

    const summary = await createSummary(metrics)

    const updatedReadme = currentReadme.replace(MetricsPlaceHolderRegex, formatSummary(summary))

    await writeFile(readmePath, updatedReadme)
}