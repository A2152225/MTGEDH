#!/usr/bin/env tsx
/**
 * CLI tool to run automation verification report
 * 
 * Usage: npx tsx cli/verify-automation.ts [options]
 * 
 * Options:
 *   --summary    Show only category summaries
 *   --critical   Show only critical items
 *   --pending    Show only pending/needs-fix items
 *   --json       Output as JSON
 */

import {
  runFullAutomationVerification,
  getAutomationSummaryByCategory,
  AutomationStatus,
  type VerificationReport,
  type AutomationCheckResult,
} from '../src/GameAutomationVerifier';

// Parse command line arguments
const args = process.argv.slice(2);
const showSummaryOnly = args.includes('--summary');
const showCriticalOnly = args.includes('--critical');
const showPendingOnly = args.includes('--pending');
const outputJson = args.includes('--json');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
MTG Rules Engine - Automation Verification Tool
================================================

This tool audits all game processes to verify they properly use the rules engine.

Usage: npx tsx cli/verify-automation.ts [options]

Options:
  --summary    Show only category summaries (no individual checks)
  --critical   Show only critical priority items
  --pending    Show only pending or needs-fix items
  --json       Output as JSON format
  --help, -h   Show this help message

Examples:
  npx tsx cli/verify-automation.ts                 # Full report
  npx tsx cli/verify-automation.ts --summary       # Summary only
  npx tsx cli/verify-automation.ts --critical      # Critical items only
  npx tsx cli/verify-automation.ts --json          # JSON output
`);
  process.exit(0);
}

function getStatusEmoji(status: AutomationStatus): string {
  switch (status) {
    case AutomationStatus.IMPLEMENTED:
      return '✅';
    case AutomationStatus.PARTIAL:
      return '🔶';
    case AutomationStatus.PENDING:
      return '❌';
    case AutomationStatus.MANUAL_REQUIRED:
      return '👤';
    case AutomationStatus.NEEDS_FIX:
      return '🔧';
    default:
      return '❓';
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'critical':
      return '\x1b[31m'; // Red
    case 'high':
      return '\x1b[33m'; // Yellow
    case 'medium':
      return '\x1b[36m'; // Cyan
    case 'low':
      return '\x1b[37m'; // White
    default:
      return '\x1b[0m';
  }
}

function resetColor(): string {
  return '\x1b[0m';
}

function printReport(report: VerificationReport): void {
  console.log('\n' + '='.repeat(80));
  console.log('   MTG RULES ENGINE - AUTOMATION VERIFICATION REPORT');
  console.log('='.repeat(80));
  console.log(`Generated: ${new Date(report.timestamp).toISOString()}`);
  console.log('');

  // Overall statistics
  console.log('OVERALL STATISTICS');
  console.log('-'.repeat(40));
  console.log(`Total Checks:     ${report.totalChecks}`);
  console.log(`✅ Implemented:   ${report.implemented}`);
  console.log(`🔶 Partial:       ${report.partial}`);
  console.log(`❌ Pending:       ${report.pending}`);
  console.log(`👤 Manual Req:    ${report.manualRequired}`);
  console.log(`🔧 Needs Fix:     ${report.needsFix}`);
  console.log('');

  // Calculate percentage
  const automatable = report.totalChecks - report.manualRequired;
  const automated = report.implemented + report.partial;
  const percentage = Math.round((automated / automatable) * 100);
  console.log(`Automation Coverage: ${percentage}% (${automated}/${automatable} automatable features)`);
  console.log('');

  if (!showSummaryOnly) {
    // Category breakdown - pass the report to avoid recomputation
    const summary = getAutomationSummaryByCategory(report);
    
    console.log('CATEGORY BREAKDOWN');
    console.log('-'.repeat(80));
    
    for (const [category, counts] of Array.from(summary.entries())) {
      console.log(`\n📁 ${category}`);
      console.log(`   Total: ${counts.total} | ✅ ${counts.implemented} | 🔶 ${counts.partial} | ❌ ${counts.pending} | 👤 ${counts.manualRequired}`);
    }
    console.log('');

    // Individual checks
    console.log('DETAILED CHECKS');
    console.log('-'.repeat(80));
    
    let currentCategory = '';
    
    let filteredChecks = report.checks;
    
    if (showCriticalOnly) {
      filteredChecks = filteredChecks.filter(c => c.priority === 'critical');
    }
    
    if (showPendingOnly) {
      filteredChecks = filteredChecks.filter(
        c => c.status === AutomationStatus.PENDING || 
             c.status === AutomationStatus.NEEDS_FIX
      );
    }
    
    for (const check of filteredChecks) {
      if (check.category !== currentCategory) {
        currentCategory = check.category;
        console.log(`\n📁 ${currentCategory}`);
        console.log('-'.repeat(60));
      }
      
      const emoji = getStatusEmoji(check.status);
      const priorityColor = getPriorityColor(check.priority);
      const reset = resetColor();
      
      console.log(`${emoji} ${priorityColor}[${check.priority.toUpperCase()}]${reset} ${check.feature}`);
      console.log(`   ${check.description}`);
      
      if (check.rulesReference) {
        console.log(`   📖 ${check.rulesReference}`);
      }
      
      if (check.details) {
        console.log(`   📝 ${check.details}`);
      }
    }
  }

  // Recommendations
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('-'.repeat(80));
  
  for (const rec of report.recommendations) {
    console.log(`  ${rec}`);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

function printJsonReport(report: VerificationReport): void {
  console.log(JSON.stringify(report, null, 2));
}

// Run verification
console.log('Running automation verification...');
const report = runFullAutomationVerification();

if (outputJson) {
  printJsonReport(report);
} else {
  printReport(report);
}

// Exit with error code if there are pending or needs-fix items
const hasIssues = report.pending > 0 || report.needsFix > 0;
process.exit(hasIssues ? 1 : 0);
