import { describe, expect, it } from 'vitest';
import { translate, LANGS, type Lang } from '@/lib/i18n';
import { SESSION_STATUS_KEYS, resolveSessionStatusI18nKey } from '../pipeline-domain';

const LANGUAGES: Lang[] = ['es', 'en', 'zh'];

/** Claves que TANDA 1 estrena. Crece con cada tanda. */
const PIPELINE_KEYS = [
  'tab.pipeline',
  'pipeline.title',
  'pipeline.loading',
  'pipeline.noRepo.title',
  'pipeline.noRepo.body',
  'pipeline.noPipeline.title',
  'pipeline.noPipeline.body',
  'pipeline.incompatible.title',
  'pipeline.incompatible.unknownVersion',
  'pipeline.error.title',
  'pipeline.error.retry',
  'pipeline.source.git',
  'pipeline.source.runtime',
  'pipeline.source.openspec',
  'pipeline.unknown.notReported',
  'pipeline.unknown.notApplicable',
  'pipeline.unknown.pendingFixture',
  'pipeline.unknown.unknown',
  'pipeline.unknown.notReported.help',
  'pipeline.unknown.notApplicable.help',
  'pipeline.unknown.pendingFixture.help',
  'pipeline.unknown.unknown.help',
  'pipeline.provenance.runtime',
  'pipeline.provenance.repo',
  'pipeline.provenance.derived',
  'pipeline.provenance.human',
  'pipeline.evidence.verified',
  'pipeline.evidence.inferred',
  'pipeline.evidence.unknown',
  'pipeline.evidence.blocked',
  'pipeline.evidence.pending_fixture',
  'pipeline.option.viewEvidence',
  'pipeline.option.approve',
  'pipeline.option.copyAnswer',
  'pipeline.agents.title',
  'pipeline.agents.empty',
  'pipeline.agent.model',
  'pipeline.agent.provider',
  'pipeline.agent.tokens',
  'pipeline.agentState.running',
  'pipeline.agentState.done',
  'pipeline.agentState.failed',
  'pipeline.agentState.unknown',
  'pipeline.role.builder',
  'pipeline.role.auditor',
  'pipeline.role.orchestrator',
  'pipeline.role.scout',
  'pipeline.activity.title',
  'pipeline.activity.filters',
  'pipeline.activity.empty',
  'pipeline.activity.noReasoning',
  'pipeline.channel.narrative',
  'pipeline.channel.reasoning',
  'pipeline.channel.tool',
  'pipeline.channel.file',
  'pipeline.channel.system',
  'pipeline.economy.title',
  'pipeline.economy.input',
  'pipeline.economy.output',
  'pipeline.economy.reasoning',
  'pipeline.economy.cacheRead',
  'pipeline.economy.cost',
  'pipeline.economy.contextMax',
  'pipeline.economy.contextCurrent',
  'pipeline.economy.compactions',
  'pipeline.details.title',
  'pipeline.details.proposal',
  'pipeline.details.diffs',
  'pipeline.details.touchedFiles',
  'pipeline.details.provenance',
  'pipeline.details.location',
  'pipeline.details.recommendation',
  'pipeline.details.noProposal',
  'pipeline.details.noDiffs',
  'pipeline.details.noFindings',
  'pipeline.details.noGateHistory',
  'pipeline.control.title',
  'pipeline.control.pauseDelegations',
  'pipeline.control.pauseAfterTask',
  'pipeline.control.steer',
  'pipeline.control.queue',
  'pipeline.control.send',
  'pipeline.control.ackPending',
  'pipeline.control.ackSuccess',
  'pipeline.control.ackError',
  'pipeline.control.cancelRun',
  'pipeline.health.healthy',
  'pipeline.hud.title',
  'pipeline.hud.phase',
  'pipeline.hud.noPhase',
  'pipeline.hud.decisions',
  'pipeline.hud.needsYou',
  'pipeline.hud.allClear',
  'pipeline.openspec.activity.noneForChange',
  'pipeline.openspec.activity.repoScope',
  'pipeline.openspec.activity.ranAt',
  'pipeline.openspec.activity.status.running',
  'pipeline.openspec.activity.status.completed',
  'pipeline.openspec.activity.status.failed',
  'pipeline.openspec.activity.status.interrupted',
  'pipeline.openspec.activity.status.unknown',
  'pipeline.openspec.activity.status.latest',
  'pipeline.openspec.activity.status.none',
  'pipeline.openspec.activity.status.idle',
  'pipeline.openspec.graph.label',
  'pipeline.openspec.graph.state.done',
  'pipeline.openspec.graph.state.ready',
  'pipeline.openspec.graph.state.blocked',
  'pipeline.openspec.graph.state.skipped',
  'pipeline.openspec.graph.state.unknown',
  'pipeline.openspec.graph.missingDeps',
  'pipeline.newChange.propose.nature',
  'pipeline.newChange.propose.objectiveHelp',
  'pipeline.newChange.propose.slugTarget',
  'pipeline.newChange.propose.constraintsHelp',
  // Pantalla de entrada del repositorio.
  'pipeline.openspec.start.title',
  'pipeline.openspec.start.newChange',
  'pipeline.openspec.start.proposeHelp',
  'pipeline.openspec.start.exploreHelp',
  'pipeline.openspec.start.back',
  'pipeline.openspec.start.inProgress',
  'pipeline.openspec.start.archived',
  'pipeline.switcher.views',
  'pipeline.switcher.toggle',
  'pipeline.switcher.toggleDisabledHelp',
  'pipeline.switcher.tasks',
  'pipeline.switcher.artifacts',
  'pipeline.switcher.diffs',
  'pipeline.switcher.activity',
  'pipeline.switcher.actions',
  'pipeline.switcher.start',
  'pipeline.switcher.tasksReturn',
  'pipeline.openspec.artifacts.timelineSlot',
  'pipeline.openspec.start.enter',
  'pipeline.openspec.start.branchMatch',
  'pipeline.openspec.start.tasks',
  'pipeline.openspec.start.noTasks',
  'pipeline.openspec.start.pending',
  'pipeline.openspec.start.pending.one',
  'pipeline.next.noSelection.title',
  'pipeline.next.noSelection.help',
  'pipeline.openspec.start.noActive',
  'pipeline.openspec.start.closed',
  'pipeline.openspec.start.neverArchived',
  'pipeline.openspec.start.archivedCount',
  'pipeline.openspec.start.archivedCount.one',
  'pipeline.openspec.start.specificationsCount',
  'pipeline.openspec.start.specsPending',
  'pipeline.openspec.start.globalProgress',
  'pipeline.openspec.start.noTasksToMeasure',
  // Preparación del commit del repositorio. Van acá para que las tres lenguas
  // queden exigidas: el riesgo real no es que falte una traducción sino que
  // quede una que hable "del cambio" sobre una superficie que ya no lo es.
  'pipeline.openspec.prepare.title',
  'pipeline.openspec.prepare.help',
  'pipeline.openspec.prepare.open',
  'pipeline.openspec.prepare.toBranch',
  'pipeline.newChange.propose.branch',
  'pipeline.newChange.propose.branchHelp',
  'pipeline.newChange.propose.branchFailed',
  'pipeline.openspec.prepare.stagedTitle',
  'pipeline.openspec.prepare.stagedEmpty',
  'pipeline.openspec.prepare.close',
  'pipeline.openspec.prepare.selected',
  'pipeline.openspec.prepare.message',
  'pipeline.openspec.prepare.messagePlaceholder',
  'pipeline.openspec.prepare.action',
  'pipeline.openspec.prepare.done',
  'pipeline.openspec.prepare.done.one',
  'pipeline.openspec.prepare.groupChange',
  'pipeline.openspec.prepare.groupChangeHelp',
  'pipeline.openspec.prepare.groupArchived',
  'pipeline.openspec.prepare.groupArchivedHelp',
  'pipeline.openspec.prepare.groupArchivedHelpPlain',
  'pipeline.openspec.prepare.groupUnattributed',
  'pipeline.openspec.prepare.groupUnattributedHelp',
  'pipeline.openspec.prepare.kind.code',
  'pipeline.openspec.prepare.kind.test',
  'pipeline.openspec.prepare.kind.docs',
  'pipeline.openspec.prepare.kind.config',
  'pipeline.openspec.prepare.kind.artifact',
  'pipeline.openspec.prepare.state.untracked',
  'pipeline.openspec.prepare.state.modified',
  'pipeline.openspec.prepare.state.deleted',
  'pipeline.openspec.prepare.state.renamed',
  'pipeline.openspec.prepare.state.added',
  'pipeline.openspec.prepare.selectAll',
  'pipeline.openspec.prepare.deselectAll',
  'pipeline.openspec.prepare.preparedSummary',
  'pipeline.openspec.prepare.preparedSummary.one',
  // Sub-namespace pipeline.openspec.engine.* (2.13)
  'pipeline.openspec.engine.cardTitle',
  'pipeline.openspec.engine.provenance.global',
  'pipeline.openspec.engine.provenance.local',
  'pipeline.openspec.engine.provenance.managed',
  'pipeline.openspec.engine.provenance.unknown',
  'pipeline.openspec.engine.versionBehindCycle',
  'pipeline.openspec.engine.reread',
  'pipeline.openspec.engine.incompleteRead',
  'pipeline.openspec.engine.axis.engine',
  'pipeline.openspec.engine.axis.repo',
  'pipeline.openspec.engine.axis.integration',
  'pipeline.openspec.engine.status.absent',
  'pipeline.openspec.engine.repoState.initialized',
  'pipeline.openspec.engine.repoState.not-initialized',
  'pipeline.openspec.engine.repoState.notInitialized',
  'pipeline.openspec.engine.repoState.unknown',
  'pipeline.openspec.engine.integrationState.up-to-date',
  'pipeline.openspec.engine.integrationState.upToDate',
  'pipeline.openspec.engine.integrationState.outdated',
  'pipeline.openspec.engine.integrationState.custom',
  'pipeline.openspec.engine.integrationState.conflicted',
  'pipeline.openspec.engine.integrationState.unknown',
  'pipeline.openspec.engine.latestAvailable',
  'pipeline.openspec.engine.cacheStatus.online',
  'pipeline.openspec.engine.cacheStatus.cached',
  'pipeline.openspec.engine.cacheStatus.cachedStale',
  'pipeline.openspec.engine.cacheStatus.offline',
  'pipeline.openspec.engine.generatedByLabel',
  'pipeline.openspec.engine.outputsTitle',
  'pipeline.openspec.engine.output.repoLocal',
  'pipeline.openspec.engine.output.externalGlobal',
  'pipeline.openspec.engine.output.blockedBadge',
  'pipeline.openspec.engine.output.githubDesc',
  'pipeline.openspec.engine.output.minimaxDesc',
  'pipeline.openspec.engine.preview.partial',
  'pipeline.openspec.engine.preview.notAvailable',
  'pipeline.openspec.engine.matrix.blockedCliNotInstalled',
  'pipeline.openspec.engine.matrix.blockedVersionUnknown',
  'pipeline.openspec.engine.matrix.blockedLegacyCoexistence',
  'pipeline.openspec.engine.matrix.blockedCustomized',
  'pipeline.openspec.engine.matrix.blockedEvidenceUnknown',
  'pipeline.openspec.engine.matrix.blockedUnclassified',
  'pipeline.openspec.engine.generalStatus.ready',
  'pipeline.openspec.engine.generalStatus.needsAttention',
  'pipeline.openspec.engine.generalStatus.unknown',
  'pipeline.openspec.engine.showAdvanced',
  'pipeline.openspec.engine.hideAdvanced',
  'pipeline.openspec.engine.agentsConfigured',
  'pipeline.openspec.engine.agentsConfiguredRatio',
  'pipeline.openspec.engine.presence.present',
  'pipeline.openspec.engine.presence.absent',
  'pipeline.openspec.engine.presence.unreadable',
  'pipeline.openspec.engine.presence.conflicting',
  'pipeline.openspec.engine.advanced.routeAndProvenance',
  'pipeline.openspec.engine.advanced.profileAndWorkflows',
  'pipeline.openspec.engine.advanced.repoEvidence',
  'pipeline.openspec.engine.advanced.globalLabel',
  'pipeline.openspec.engine.advanced.repoLabel',
  'pipeline.openspec.engine.advanced.showAbsentOutputs',
  'pipeline.openspec.engine.advanced.hideAbsentOutputs',
  'pipeline.openspec.engine.advanced.convergentNotice',
  'pipeline.openspec.engine.advanced.divergentNotice',
  'pipeline.openspec.engine.advanced.undeterminedNotice',
  'pipeline.openspec.engine.advanced.doctorTitle',
  'pipeline.openspec.engine.advanced.doctorHelp',
  'pipeline.openspec.engine.advanced.contextTitle',
  'pipeline.openspec.engine.advanced.contextHelp',
  'pipeline.openspec.engine.advanced.cliClean',
  'pipeline.openspec.engine.advanced.cliUnavailable',
  'pipeline.openspec.engine.advanced.fixLabel',
  'pipeline.openspec.engine.attentionReason.outdated',
  'pipeline.openspec.engine.attentionReason.notInitialized',
  'pipeline.openspec.engine.attentionReason.divergent',
  'pipeline.openspec.engine.divergence.none',
  'pipeline.openspec.engine.divergence.profileMismatch',
  'pipeline.openspec.engine.divergence.targetWorkflows',
  'pipeline.openspec.engine.divergence.allMissing',
  'pipeline.openspec.engine.divergence.targetMissing',
  'pipeline.openspec.engine.divergence.targetExtra',
  'pipeline.openspec.engine.divergence.recommendation',
  'pipeline.openspec.engine.divergence.lang',
  'pipeline.openspec.engine.outputsHelp',
  'pipeline.openspec.engine.absentOutputsHelp',
  'pipeline.openspec.engine.reviewAction',
  'pipeline.openspec.engine.review.title',
  'pipeline.openspec.coexistence.colSkill',
  'pipeline.openspec.coexistence.colType',
  'pipeline.openspec.coexistence.typeOfficial',
  'pipeline.openspec.coexistence.typeCustom',
  'pipeline.openspec.coexistence.typeLegacy',
  'pipeline.openspec.coexistence.tableCaption',
  'pipeline.openspec.config.engineBlock',
  'pipeline.openspec.config.agentsBlock',
  'pipeline.openspec.config.profileBlock',
  'pipeline.openspec.config.engineSection',
  'pipeline.openspec.config.statusLine',
  'pipeline.openspec.config.open',
  'pipeline.openspec.config.railTitle',
  'pipeline.openspec.config.railEntry',
  'pipeline.openspec.engine.review.close',
  'pipeline.openspec.engine.matrix.title',
  'pipeline.openspec.engine.matrix.actionLabel',
  'pipeline.openspec.engine.matrix.init',
  'pipeline.openspec.engine.matrix.update',
  'pipeline.openspec.engine.matrix.upgradeInit',
  'pipeline.openspec.engine.matrix.upgradeUpdate',
  'pipeline.openspec.engine.matrix.none',
  'pipeline.openspec.engine.matrix.blocked',
  'pipeline.openspec.engine.matrix.blockedReason',
  'pipeline.openspec.engine.matrix.commandTitle',
  'pipeline.openspec.engine.matrix.commandHelp',
  'pipeline.openspec.engine.matrix.copyCommand',
  'pipeline.openspec.engine.matrix.commandCopied',
  'pipeline.openspec.engine.guide.title',
  'pipeline.openspec.engine.guide.toolsArg',
  'pipeline.openspec.engine.guide.profileArg',
  'pipeline.openspec.engine.guide.noAnimationArg',
  'pipeline.openspec.engine.guide.copilotArg',
  'pipeline.openspec.engine.guide.forceWarning',
  'pipeline.openspec.engine.coexistence.title',
  'pipeline.openspec.engine.coexistence.legacyTitle',
  'pipeline.openspec.engine.coexistence.legacyHelp',
  'pipeline.openspec.engine.coexistence.newTitle',
  'pipeline.openspec.engine.coexistence.newHelp',
  'pipeline.openspec.engine.coexistence.officialOtherTitle',
  'pipeline.openspec.engine.coexistence.officialOtherHelp',
  'pipeline.openspec.engine.coexistence.customTitle',
  'pipeline.openspec.engine.coexistence.customHelp',
  'pipeline.openspec.engine.coexistence.noLegacy',
  'pipeline.openspec.engine.coexistence.noNew',
  'pipeline.openspec.engine.coexistence.noOfficialOther',
  'pipeline.openspec.engine.coexistence.noCustom',
  'pipeline.openspec.engine.coexistence.collisionsTitle',
  'pipeline.openspec.engine.coexistence.noCollisions',
  'pipeline.openspec.engine.freshness.cliUpToDate',
  'pipeline.openspec.engine.freshness.cliUpgradeAvailable',
  'pipeline.openspec.engine.freshness.offline',
  'pipeline.openspec.engine.versionClass.supported',
  'pipeline.openspec.engine.versionClass.tooOld',
  'pipeline.openspec.engine.versionClass.unknown',
  'pipeline.openspec.engine.summary.engineUpToDate',
  'pipeline.openspec.engine.summary.integrationLabel',
  'pipeline.openspec.engine.summary.terminalToggle',
  'pipeline.openspec.engine.summary.technicalToggle',
  'pipeline.openspec.engine.summary.allUpToDate',
  'pipeline.openspec.engine.summary.updateAll',
  'pipeline.openspec.engine.summary.planLine',
  'pipeline.openspec.engine.summary.stepEngine',
  'pipeline.openspec.engine.summary.stepEngineLocal',
  'pipeline.openspec.engine.summary.stepEngineUnavailableUnknown',
  'pipeline.openspec.engine.summary.stepEngineUnavailableManaged',
  'pipeline.openspec.engine.summary.versionMismatch',
  'pipeline.openspec.engine.summary.provenanceLocal',
  'pipeline.openspec.engine.summary.provenanceGlobal',
  'pipeline.openspec.engine.summary.provenanceUnknown',
  'pipeline.openspec.engine.summary.stepIntegration',
  'pipeline.openspec.engine.summary.rowEngine',
  'pipeline.openspec.engine.summary.stoppedAfterEngine',
  'pipeline.openspec.engine.summary.stoppedAfterMismatch',
  'pipeline.openspec.engine.summary.resultDone',
  'pipeline.openspec.engine.summary.doneEngine',
  'pipeline.openspec.engine.summary.doneIntegration',
  'pipeline.openspec.engine.summary.resultFailed',
  'pipeline.openspec.engine.summary.filesTouched',
  'pipeline.openspec.engine.summary.toastDone',
  'pipeline.openspec.engine.summary.planStale',
  'pipeline.openspec.engine.summary.engineLabel',
  'pipeline.openspec.engine.hostUpgrade.offer',
  'pipeline.openspec.engine.hostUpgrade.help',
  'pipeline.openspec.engine.hostUpgrade.command',
  'pipeline.openspec.engine.hostUpgrade.copy',
  'pipeline.openspec.engine.hostUpgrade.copied',
  'pipeline.openspec.engine.pill.notDetected',
  'pipeline.openspec.engine.pill.upgradeAvailable',
  'pipeline.openspec.engine.review.confirmMain',
  'pipeline.openspec.engine.review.confirmDirty',
  'pipeline.openspec.engine.review.updateAnyway',
  'pipeline.openspec.engine.review.cancel',
  'pipeline.openspec.engine.review.updating',
  'pipeline.openspec.engine.review.completedTitle',
  'pipeline.openspec.engine.review.filesUpdatedSummary',
  'pipeline.openspec.engine.review.prepareCommit',
  'pipeline.openspec.engine.review.incompleteTitle',
  'pipeline.openspec.engine.review.incompleteHelp',
  'pipeline.openspec.engine.review.blockedBranchMain',
  'pipeline.openspec.engine.review.blockedDirty',
  'pipeline.openspec.engine.review.errorTitle',
  'pipeline.openspec.engine.review.errorGeneric',
  'pipeline.openspec.engine.review.errorCliNotFound',
  'pipeline.openspec.engine.review.legacySkillsTitle',
  'pipeline.openspec.engine.review.legacySkillsDesc',
  'pipeline.openspec.engine.review.removeLegacySkillsBtn',
  'pipeline.openspec.engine.review.removeConfirmTitle',
  'pipeline.openspec.engine.review.removeConfirmPrompt',
  'pipeline.openspec.engine.review.removeConfirmBtn',
  'pipeline.openspec.engine.review.removeCancelBtn',
  'pipeline.openspec.engine.review.nonRemovableTitle',
  'pipeline.openspec.engine.review.reasonUntracked',
  'pipeline.openspec.engine.review.reasonModified',
  'pipeline.openspec.engine.review.reasonRemoveFailed',
  'pipeline.openspec.engine.review.removeError',
  'pipeline.openspec.engine.review.legacyPlanChecking',
  'pipeline.openspec.engine.review.legacyPlanCheckFailed',
  'pipeline.openspec.engine.review.removalSuccess',
  'pipeline.openspec.readiness.ciInfo',
  'pipeline.openspec.readiness.configuredViaSharedFolder',
  'pipeline.openspec.tool.sinceVersion',
  'pipeline.openspec.tool.sinceVersionOrEarlier',
  'pipeline.openspec.tool.afterCycleVersion',
  'pipeline.openspec.tool.noDescription',
  'pipeline.openspec.engine.summary.integrationNotUpToDate',
  'pipeline.openspec.engine.summary.integrationUnverified',
  'pipeline.openspec.engine.summary.reasonUnconfiguredTools',
  'pipeline.openspec.engine.review.removalSummaryLine',
  'pipeline.openspec.engine.review.viewRemovalList',
  'pipeline.openspec.engine.review.hideRemovalList',
  'pipeline.openspec.engine.review.closeRemovalSection',
  'pipeline.openspec.releaseNotes.showMore',
  'pipeline.openspec.releaseNotes.showLess',
  'toolbar.actionsMenu',
  'toolbar.toolsMenu',
  'toolbar.branchFilter',
  'sidebar.navigation',
  'canvas.controls',
  'canvas.zoomIn',
  'canvas.zoomOut',
  'canvas.resetZoom',
  'canvas.speculativeBranches',
  'canvas.openCentauro',
  'shortcuts.pipelineTab',
  'shortcuts.terminal',
  'shortcuts.branchFilter',
  'graph.colBranchTag',
  'graph.colGraph',
  'graph.colMessage',
  'graph.colDate',
  'graph.colCommit',
  'graph.speculativeBadge',
  'graph.speculativeBadgeTooltip',
  'graph.filterActive',
  'history.header',
  'history.filteredHeader',
  'pipeline.openspec.task.error.mismatch',
  'pipeline.openspec.task.error.notFound',
  'pipeline.openspec.task.error.archived',
  'pipeline.openspec.task.error.notATask',
  'pipeline.openspec.task.error.emptyText',
  'pipeline.openspec.task.error.outOfBounds',
  'pipeline.openspec.task.reload',
  'pipeline.openspec.task.add',
  'pipeline.openspec.task.addPlaceholder',
  'pipeline.openspec.task.addSubmit',
  'pipeline.openspec.task.addCancel',
  'pipeline.openspec.task.edit',
  'pipeline.openspec.task.editSave',
  'pipeline.openspec.task.editCancel',
  'pipeline.openspec.task.delete',
  'pipeline.openspec.task.deleteConfirm',
  'pipeline.openspec.task.moveUp',
  'pipeline.openspec.task.moveDown',
  'pipeline.openspec.task.dragHandle',
  'pipeline.openspec.task.viewList',
  'pipeline.openspec.task.viewRaw',
  'pipeline.openspec.task.rawSave',
  'pipeline.openspec.task.rawSaving',
  'pipeline.openspec.task.rawSaved',
  'pipeline.openspec.task.rawDirtyWarning',
  'pipeline.openspec.task.rawDirtyHelp',
  'pipeline.openspec.task.rawDiscard',
  'pipeline.openspec.task.rawKeepEditing',
  'pipeline.openspec.task.rawSaveAndSwitch',
  'pipeline.openspec.task.malformedTitle',
  'pipeline.openspec.task.malformedDesc',
  'pipeline.openspec.task.copyMarkdown',
  'pipeline.openspec.task.copiedMarkdown',
  'pipeline.openspec.task.moreActions',
  'pipeline.openspec.task.editHint',
  'pipeline.openspec.task.viewFormatted',
  'pipeline.openspec.task.editInRaw',
  'pipeline.openspec.task.markdownTab',
  'pipeline.openspec.task.editAction',
  'pipeline.openspec.start.pinAction',
  'pipeline.openspec.start.unpinAction',
  'pipeline.openspec.start.pinned',
  'pipeline.openspec.sync.title',
  'pipeline.openspec.sync.action',
  'pipeline.openspec.sync.unavailable',
  'pipeline.openspec.sync.unavailableReason',
  'pipeline.openspec.archive.reasonLabel',
  'pipeline.openspec.archive.reasonPlaceholder',
  'pipeline.openspec.archive.reasonPendingWarning',
  'pipeline.openspec.archive.blockedMainBranch',
  'pipeline.openspec.archive.copyCommand',
  'pipeline.openspec.archive.copiedCommand',
  'pipeline.openspec.archive.executeCommand',
  'pipeline.openspec.archive.commandRunning',
  'pipeline.openspec.engine.install.localTitle',
  'pipeline.openspec.engine.install.localUnavailable',
  'pipeline.openspec.engine.install.localNoManifest',
  'pipeline.openspec.engine.install.globalTitle',
  'pipeline.openspec.engine.install.globalUnavailable',
  'pipeline.openspec.engine.install.affectedRepos',
  'pipeline.openspec.engine.install.confirmGlobalPrompt',
  'pipeline.openspec.engine.install.confirmGlobalAction',
  'pipeline.openspec.engine.install.cancelGlobalAction',
  'pipeline.openspec.engine.install.installingLocal',
  'pipeline.openspec.engine.install.installingGlobal',
  'pipeline.openspec.engine.install.successLocal',
  'pipeline.openspec.engine.install.successGlobal',
  'pipeline.openspec.engine.afterInstall.resultTitle',
  'pipeline.openspec.engine.afterInstall.ok',
  'pipeline.openspec.engine.afterInstall.broken',
  'pipeline.openspec.engine.afterInstall.unverified',
  'pipeline.openspec.engine.afterInstall.rollback',
  'pipeline.openspec.engine.afterInstall.rollingBack',
  'pipeline.openspec.engine.afterInstall.notFound',
  'pipeline.openspec.engine.afterInstall.versionUnreadable',
  'pipeline.openspec.engine.afterInstall.doctorUnparsable',
  'pipeline.openspec.engine.afterInstall.configUnreadable',
  'pipeline.openspec.engine.install.commandPendingResolution',
  'pipeline.openspec.engine.install.error.noManifest',
  'pipeline.openspec.engine.install.error.packageManagerNotFound',
  'pipeline.openspec.engine.install.error.permissionDenied',
  'pipeline.openspec.engine.install.error.invalidTargetVersion',
  'pipeline.openspec.engine.install.error.installFailed',
  'pipeline.openspec.engine.review.summaryLine',
  'pipeline.openspec.engine.review.toggleDetails',
  // Panel de perfil de workflows global (Tanda 7.2b)
  'pipeline.openspec.engine.profile.title',
  'pipeline.openspec.engine.profile.help',
  'pipeline.openspec.engine.profile.enabled',
  'pipeline.openspec.engine.profile.disabledByProfile',
  'pipeline.openspec.engine.profile.toggleOn',
  'pipeline.openspec.engine.profile.toggleOff',
  'pipeline.openspec.engine.profile.noData',
  'pipeline.openspec.engine.profile.saving',
  'pipeline.openspec.engine.profile.channelUnavailable',
  'pipeline.openspec.engine.profile.noRepo',
  'pipeline.openspec.engine.profile.error',
  'pipeline.openspec.engine.profile.notCustomReason',
  'pipeline.openspec.engine.profile.switchToCustom',
  'pipeline.openspec.engine.profile.switchingToCustom',
  'pipeline.openspec.engine.profile.switchError',
  'pipeline.openspec.engine.profile.lockClosed',
  'pipeline.openspec.engine.profile.lockOpen',
  'pipeline.openspec.engine.profile.lockOpenTitle',
  'pipeline.openspec.engine.profile.missingIntegration',
  'pipeline.openspec.engine.profile.missingProfile',
  // Notas de versión de OpenSpec (Tanda 8.23 c1)
  'pipeline.openspec.releaseNotes.title',
  'pipeline.openspec.releaseNotes.loading',
  'pipeline.openspec.releaseNotes.viewFull',
  'pipeline.openspec.releaseNotes.source',
  'pipeline.openspec.releaseNotes.unavailable',
  'pipeline.openspec.releaseNotes.mayAffect',
  'pipeline.openspec.releaseNotes.compatible',
  'pipeline.openspec.releaseNotes.redactedBy',
  'pipeline.openspec.releaseNotes.error',
  'pipeline.openspec.releaseNotes.reportUnavailable',
  'pipeline.openspec.releaseNotes.draftReport',
  'pipeline.openspec.releaseNotes.loadAndDraft',
  'pipeline.openspec.releaseNotes.chooseModelReason',
  'pipeline.openspec.releaseNotes.redactingWith',
  'pipeline.openspec.releaseNotes.loadingAndRedactingWith',
  'pipeline.openspec.releaseNotes.cancelDraft',
  // Grafo de artefactos (Tanda 3)
  'pipeline.openspec.graph.label',
  'pipeline.openspec.graph.state.done',
  'pipeline.openspec.graph.state.ready',
  'pipeline.openspec.graph.state.blocked',
  'pipeline.openspec.graph.state.skipped',
  'pipeline.openspec.graph.state.unknown',
  'pipeline.openspec.graph.missingDeps',
  'pipeline.openspec.graph.artifact.proposal',
  'pipeline.openspec.graph.artifact.design',
  'pipeline.openspec.graph.artifact.specs',
  'pipeline.openspec.graph.artifact.tasks',
  'pipeline.openspec.graph.generateWithAgent',
  'pipeline.openspec.graph.requires',
  'pipeline.openspec.graph.confirmOverwrite',
  'pipeline.openspec.graph.confirmAndLaunch',
  'pipeline.openspec.graph.error',
  'pipeline.openspec.graph.loading',
] as const;


describe('Pipeline i18n', () => {
  it('covers the three shipped languages', () => {
    expect(LANGS.map((entry) => entry.code).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)('resolves every pipeline key in %s', (lang) => {
    const missing = PIPELINE_KEYS.filter((key) => {
      const value = translate(key, lang);
      // translate() devuelve la clave cuando no encuentra traducción.
      return !value || value === key;
    });
    expect(missing).toEqual([]);
  });

  it('interpolates the version into the incompatible message in every language', () => {
    for (const lang of LANGUAGES) {
      const text = translate('pipeline.incompatible.body', lang, { version: '9.9' });
      expect(text).toContain('9.9');
      expect(text).not.toContain('{version}');
    }
  });

  it('interpolates every multi-variable string in all languages', () => {
    for (const lang of LANGUAGES) {
      const coverage = translate('pipeline.economy.partialCoverage', lang, { withCost: 2, total: 3 });
      expect(coverage).toContain('2');
      expect(coverage).toContain('3');
      expect(coverage).not.toMatch(/\{\{/);

      const tokens = translate('pipeline.agent.tokensValue', lang, { input: 10, output: 20 });
      expect(tokens).toContain('10');
      expect(tokens).not.toMatch(/\{\{/);

      const progress = translate('pipeline.now.taskProgress', lang, { done: 3, total: 7 });
      expect(progress).not.toMatch(/\{\{/);

      const selected = translate('pipeline.openspec.prepare.selected', lang, { count: 2, total: 5 });
      expect(selected).toContain('2');
      expect(selected).toContain('5');
      expect(selected).not.toMatch(/\{\{/);

      // El rótulo del grupo tiene que poder nombrar el cambio en las tres
      // lenguas: sin el identificador, dos grupos se leerían igual.
      const group = translate('pipeline.openspec.prepare.groupChange', lang, { change: 'mi-cambio' });
      expect(group).toContain('mi-cambio');
      expect(group).not.toMatch(/\{\{/);

      // El avance de un cambio en la pantalla de entrada: sin los dos números,
      // un repositorio casi terminado se lee igual que uno recién empezado.
      const tasks = translate('pipeline.openspec.start.tasks', lang, { done: 5, total: 6 });
      expect(tasks).toContain('5');
      expect(tasks).toContain('6');
      expect(tasks).not.toMatch(/\{\{/);

      // El avance global de tareas en la cabecera de la pantalla de entrada
      const globalProgress = translate('pipeline.openspec.start.globalProgress', lang, { percent: 75 });
      expect(globalProgress).toContain('75');
      expect(globalProgress).not.toMatch(/\{\{/);

      // Divergencia de perfiles y workflows estructurada en las 3 lenguas
      const profileDiv = translate('pipeline.openspec.engine.divergence.profileMismatch', lang, {
        global: 'core',
        repo: 'custom',
      });
      expect(profileDiv).toContain('core');
      expect(profileDiv).toContain('custom');
      expect(profileDiv).not.toMatch(/\{\{/);

      const targetDiv = translate('pipeline.openspec.engine.divergence.targetWorkflows', lang, {
        target: 'Agents Multi-Agent',
        targetCount: 0,
        targetWorkflows: translate('pipeline.openspec.engine.divergence.none', lang),
        globalCount: 5,
        globalWorkflows: 'apply, archive, explore, propose, sync',
      });
      expect(targetDiv).toContain('Agents Multi-Agent');
      expect(targetDiv).toContain('apply, archive, explore, propose, sync');
      expect(targetDiv).not.toMatch(/\{\{/);
    }
  });

  it('never renders a missing value as zero', () => {
    // La regla central del brief: unknown no es cero.
    for (const lang of LANGUAGES) {
      for (const key of ['pipeline.unknown.unknown', 'pipeline.unknown.notReported'] as const) {
        expect(translate(key, lang).trim()).not.toBe('0');
      }
    }
  });

  describe('SDD renaming (Spec Driven Development)', () => {
    it.each(LANGUAGES)('names the view and tab as SDD in %s without translating the acronym', (lang) => {
      expect(translate('tab.pipeline', lang)).toBe('SDD');
      expect(translate('pipeline.title', lang)).toBe('SDD');
    });

    it('names SDD correctly in HUD and shortcut descriptions across all three languages', () => {
      expect(translate('pipeline.hud.title', 'es')).toBe('Estado de SDD');
      expect(translate('pipeline.hud.title', 'en')).toBe('SDD status');
      expect(translate('pipeline.hud.title', 'zh')).toBe('SDD 状态');

      expect(translate('shortcuts.pipelineTab', 'es')).toBe('Tab SDD');
      expect(translate('shortcuts.pipelineTab', 'en')).toBe('SDD tab');
      expect(translate('shortcuts.pipelineTab', 'zh')).toBe('SDD 标签');
    });

    it.each(LANGUAGES)('ensures no visible string in %s contains "Pipeline" or "流水线"', (lang) => {
      for (const key of PIPELINE_KEYS) {
        const text = translate(key, lang);
        expect(text).not.toContain('Pipeline');
        expect(text).not.toContain('流水线');
      }
    });
  });

  describe('session status i18n resolution', () => {
    it('resolves every sessionStatusKey to a translated text and never the raw key in ES, EN, ZH', () => {
      for (const lang of LANGUAGES) {
        for (const status of SESSION_STATUS_KEYS) {
          const key = resolveSessionStatusI18nKey(status);
          const text = translate(key, lang);
          expect(text).toBeTruthy();
          expect(text).not.toBe(key);
          expect(text).not.toContain('pipeline.openspec.activity.status');
        }
      }
    });

    it('fallback defaults to a valid declared status key and resolves to translated string', () => {
      for (const lang of LANGUAGES) {
        const fallbackKey = resolveSessionStatusI18nKey('unrecognized_status_value');
        const text = translate(fallbackKey, lang);
        expect(text).toBeTruthy();
        expect(text).not.toBe(fallbackKey);
        expect(text).not.toBe('unrecognized_status_value');
        expect(text).not.toContain('pipeline.openspec.activity.status');

        const nullKey = resolveSessionStatusI18nKey(null);
        const nullText = translate(nullKey, lang);
        expect(nullText).toBeTruthy();
        expect(nullText).not.toBe(nullKey);
        expect(nullText).not.toContain('pipeline.openspec.activity.status');
      }
    });
  });
});
