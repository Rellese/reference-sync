/* ============================================================
   ReferenceSync — восстановление аварийно прерванного задания

   Активное задание хранится только до штатного завершения.
   При аварии manifest и связанная staging-папка сохраняются.
   ============================================================ */

import {
  ensureDir,
  nodeApi,
  workRoot,
} from './node-bridge.js';

const RECOVERY_VERSION = 1;
const RECOVERY_FILE = 'active-job.json';

function uniqueSorted(values) {
  return [...new Set(
    (values || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

export function normalizeRecoveryState(source) {
  const input = source || {};

  const normalized = {
    version: RECOVERY_VERSION,
    jobId: String(input.jobId || '').trim(),
    phase: String(input.phase || 'idle').trim(),
    stagingRoot: String(input.stagingRoot || '').trim(),
    selectedPostIds: uniqueSorted(input.selectedPostIds),
    completedPostIds: uniqueSorted(input.completedPostIds),
  };

  const optionalFields = [
    'settings',
    'posts',
    'downloaded',
    'failedPostIds',
    'createdEagleItems',
    'startedAt',
    'updatedAt',
  ];

  optionalFields.forEach((field) => {
    if (input[field] !== undefined) {
      normalized[field] = cloneJson(input[field], null);
    }
  });

  return normalized;
}

export function shouldRecoverJob(
  recovery,
  {
    stagingExists = false,
    closedGracefully = false,
  } = {},
) {
  if (closedGracefully) return false;
  if (!recovery?.jobId) return false;

  const recoverablePhases = new Set([
    'searching',
    'ready',
    'downloading',
    'importing',
  ]);

  if (!recoverablePhases.has(recovery.phase)) {
    return false;
  }

  /* Если manifest ссылается на staging, папка должна существовать.
     Для searching/ready staging ещё может не быть. */
  if (recovery.stagingRoot && !stagingExists) {
    return false;
  }

  return true;
}

function recoveryDirectory(root = null) {
  if (!nodeApi.available) return null;

  const base = root || workRoot();
  if (!base) return null;

  return ensureDir(
    nodeApi.path.join(base, 'jobs'),
  );
}

function recoveryPath(root = null) {
  const directory = recoveryDirectory(root);
  if (!directory) return null;

  return nodeApi.path.join(
    directory,
    RECOVERY_FILE,
  );
}

function stagingDirectory(root = null) {
  if (!nodeApi.available) return null;

  const base = root || workRoot();
  if (!base) return null;

  return ensureDir(
    nodeApi.path.join(base, 'staging'),
  );
}

function isInsideDirectory(candidate, parent) {
  if (!candidate || !parent || !nodeApi.available) {
    return false;
  }

  const resolvedCandidate =
    nodeApi.path.resolve(candidate);

  const resolvedParent =
    nodeApi.path.resolve(parent);

  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(
      `${resolvedParent}${nodeApi.path.sep}`,
    )
  );
}

export function saveRecoveryState(
  recovery,
  { root = null } = {},
) {
  if (!nodeApi.available) return false;

  const file = recoveryPath(root);
  if (!file) return false;

  const normalized = normalizeRecoveryState({
    ...recovery,
    updatedAt: Date.now(),
  });

  try {
    const temporaryFile = `${file}.tmp`;

    nodeApi.fs.writeFileSync(
      temporaryFile,
      JSON.stringify(normalized, null, 2),
      'utf8',
    );

    nodeApi.fs.renameSync(
      temporaryFile,
      file,
    );

    return true;
  } catch (_) {
    return false;
  }
}

export function loadRecoveryState(
  { root = null } = {},
) {
  if (!nodeApi.available) return null;

  const file = recoveryPath(root);
  if (!file) return null;

  try {
    const parsed = JSON.parse(
      nodeApi.fs.readFileSync(file, 'utf8'),
    );

    return normalizeRecoveryState(parsed);
  } catch (_) {
    return null;
  }
}

export function stagingExists(stagingRoot) {
  if (!nodeApi.available || !stagingRoot) {
    return false;
  }

  try {
    return (
      nodeApi.fs.existsSync(stagingRoot) &&
      nodeApi.fs.statSync(stagingRoot).isDirectory()
    );
  } catch (_) {
    return false;
  }
}

export function clearRecoveryState({
  root = null,
  stagingRoot = '',
  removeStaging = true,
} = {}) {
  if (!nodeApi.available) return false;

  const file = recoveryPath(root);
  const stagingBase = stagingDirectory(root);

  try {
    if (
      removeStaging &&
      stagingRoot &&
      isInsideDirectory(stagingRoot, stagingBase)
    ) {
      nodeApi.fs.rmSync(stagingRoot, {
        recursive: true,
        force: true,
      });
    }

    if (file) {
      nodeApi.fs.rmSync(file, {
        force: true,
      });

      nodeApi.fs.rmSync(`${file}.tmp`, {
        force: true,
      });
    }

    return true;
  } catch (_) {
    return false;
  }
}

export function cleanupOrphanedStaging({
  root = null,
  activeStagingRoot = '',
} = {}) {
  if (!nodeApi.available) return 0;

  const stagingBase = stagingDirectory(root);
  if (!stagingBase) return 0;

  let entries = [];

  try {
    entries = nodeApi.fs.readdirSync(
      stagingBase,
      { withFileTypes: true },
    );
  } catch (_) {
    return 0;
  }

  let removed = 0;

  entries.forEach((entry) => {
    if (!entry.isDirectory()) return;

    const candidate = nodeApi.path.join(
      stagingBase,
      entry.name,
    );

    if (
      activeStagingRoot &&
      nodeApi.path.resolve(candidate) ===
        nodeApi.path.resolve(activeStagingRoot)
    ) {
      return;
    }

    try {
      nodeApi.fs.rmSync(candidate, {
        recursive: true,
        force: true,
      });

      removed += 1;
    } catch (_) {
      /* Не мешаем запуску плагина из-за одной повреждённой папки. */
    }
  });

  return removed;
}
