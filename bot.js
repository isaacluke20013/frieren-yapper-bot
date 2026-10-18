import { Bot, Embed, Button, Row } from './yapper.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const token = process.env.YAPPER_BOT_TOKEN;
if (!token) {
  console.error('Missing YAPPER_BOT_TOKEN');
  process.exit(1);
}

const bot = new Bot(token);

const WIKI_API = 'https://frieren.fandom.com/api.php';
const WIKI_BASE = 'https://frieren.fandom.com/wiki/';

const STAFF_PANEL_CHANNEL_NAME = 'staff-applications';
const APPLICATION_CATEGORY_NAME = 'Staff Applications';
const FALLBACK_BOT_ROLE_NAME = 'Bot';

const DEFAULT_STAFF_ROLE_NAMES = [
  'Owner',
  'High Priest',
  'Priest',
  'Trial Priest'
];

const DEFAULT_ACCEPT_ROLE_NAME = 'Trial Priest';

const DEFAULT_APP_ROLE_NAMES = [
  'app-1',
  'app-2',
  'app-3',
  'app-4',
  'app-5',
  'app-6',
  'app-7',
  'app-8',
  'app-9',
  'app-10'
];

const DEFAULT_QUESTIONS = [
  'Yapper Username',
  'Have you moderated before?',
  'How old are you?',
  'Why do you wish to mod for this server?',
  'Do you agree to the following? You can be removed from the mod team at any time if accepted, you must follow the rules, and if you are rejected you cannot make a big fuss about it.'
];

const DATA_FOLDER = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  'FrierenYapperBot'
);

if (!fs.existsSync(DATA_FOLDER)) {
  fs.mkdirSync(DATA_FOLDER, {
    recursive: true
  });
}

const APPLICATION_DATA_FILE = path.join(
  DATA_FOLDER,
  'staff-applications.json'
);

const MANGA = {
  latestChapter: 147,
  latestRelease: 'October 14, 2025',
  nextChapter: 148,
  nextRelease: null,
  hiatus: true
};

// ============================================================
// SAVED DATA
// ============================================================

function defaultApplicationData() {
  return {
    active: {},
    queue: [],
    staffConfig: {},
    setupConfig: {}
  };
}

function loadApplicationData() {
  try {
    if (!fs.existsSync(APPLICATION_DATA_FILE)) {
      const fresh =
        defaultApplicationData();

      fs.writeFileSync(
        APPLICATION_DATA_FILE,
        JSON.stringify(
          fresh,
          null,
          2
        )
      );

      return fresh;
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          APPLICATION_DATA_FILE,
          'utf8'
        )
      );

    return {
      active:
        parsed.active || {},

      queue:
        Array.isArray(
          parsed.queue
        )
          ? parsed.queue
          : [],

      staffConfig:
        parsed.staffConfig || {},

      setupConfig:
        parsed.setupConfig || {}
    };
  } catch (err) {
    console.error(
      '[applications] could not load saved data:',
      err.message
    );

    return defaultApplicationData();
  }
}

const applicationData =
  loadApplicationData();

function saveApplicationData() {
  try {
    fs.writeFileSync(
      APPLICATION_DATA_FILE,
      JSON.stringify(
        applicationData,
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      '[applications] could not save data:',
      err.message
    );
  }
}

// ============================================================
// GENERAL HELPERS
// ============================================================

const pickRandom = array =>
  array[
    Math.floor(
      Math.random() *
      array.length
    )
  ];

const wait = ms =>
  new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

function safeChannelName(
  username = 'applicant'
) {
  return username
    .toLowerCase()
    .replace(
      /[^a-z0-9-]/g,
      '-'
    )
    .replace(
      /-+/g,
      '-'
    )
    .replace(
      /^-|-$/g,
      ''
    )
    .slice(
      0,
      40
    ) || 'applicant';
}

function getContextUserId(
  context
) {
  return (
    context?.user_id ||
    context?.author_id ||
    context?.user?.id ||
    context?.author?.id ||
    null
  );
}

async function retry404(
  label,
  action,
  attempts = 6
) {
  let lastError =
    null;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    try {
      return await action();
    } catch (err) {
      lastError =
        err;

      console.error(
        `[applications] ${label} attempt ${attempt} failed:`,
        err.message
      );

      if (
        err.status !== 404 ||
        attempt === attempts
      ) {
        throw err;
      }

      await wait(
        750 *
        attempt
      );
    }
  }

  throw lastError;
}

async function getServerId(
  context
) {
  if (
    context.server_id
  ) {
    return context.server_id;
  }

  const servers =
    await bot.servers();

  for (
    const server
    of servers
  ) {
    const channels =
      await bot.channels(
        server.id
      );

    if (
      channels.some(
        channel =>
          channel.id ===
          context.channel_id
      )
    ) {
      return server.id;
    }
  }

  return null;
}

const getRoles =
  serverId =>
    bot.roles(
      serverId
    );

const findRoleByName =
  (
    roles,
    name
  ) =>
    roles.find(
      role =>
        String(
          role.name || ''
        ).toLowerCase() ===
        String(
          name || ''
        ).toLowerCase()
    ) || null;

const findRoleById =
  (
    roles,
    roleId
  ) =>
    roles.find(
      role =>
        String(
          role.id
        ) ===
        String(
          roleId
        )
    ) || null;

function memberRoleIds(
  member
) {
  const ids =
    new Set();

  for (
    const id
    of member?.role_ids || []
  ) {
    ids.add(
      String(id)
    );
  }

  for (
    const role
    of member?.roles || []
  ) {
    if (
      typeof role ===
      'string'
    ) {
      ids.add(
        String(role)
      );
    } else if (
      role?.id
    ) {
      ids.add(
        String(
          role.id
        )
      );
    }
  }

  return ids;
}

function memberRoleNames(
  member
) {
  const names =
    new Set();

  for (
    const role
    of member?.roles || []
  ) {
    if (
      typeof role ===
        'object' &&
      role?.name
    ) {
      names.add(
        String(
          role.name
        ).toLowerCase()
      );
    }
  }

  return names;
}

async function getServerObject(
  serverId
) {
  try {
    return await bot.server(
      serverId
    );
  } catch {
    try {
      const servers =
        await bot.servers();

      return (
        servers.find(
          server =>
            String(
              server.id
            ) ===
            String(
              serverId
            )
        ) ||
        null
      );
    } catch {
      return null;
    }
  }
}

function serverOwnerIds(
  server
) {
  return [
    server?.owner_id,
    server?.ownerId,
    server?.owner?.id,
    server?.creator_id,
    server?.created_by
  ]
    .filter(Boolean)
    .map(String);
}

async function getPanelChannel(
  serverId
) {
  const channels =
    await bot.channels(
      serverId
    );

  return (
    channels.find(
      channel =>
        String(
          channel.name ||
          ''
        ).toLowerCase() ===
        STAFF_PANEL_CHANNEL_NAME
          .toLowerCase()
    ) ||
    null
  );
}

// ============================================================
// STAFF CONFIG
// ============================================================

async function buildDefaultStaffConfig(
  serverId
) {
  const roles =
    await getRoles(
      serverId
    );

  const staffRoleIds =
    DEFAULT_STAFF_ROLE_NAMES
      .map(
        name =>
          findRoleByName(
            roles,
            name
          )?.id
      )
      .filter(Boolean)
      .map(String);

  const acceptRole =
    findRoleByName(
      roles,
      DEFAULT_ACCEPT_ROLE_NAME
    );

  const acceptedRoleId =
    acceptRole
      ? String(
          acceptRole.id
        )
      : null;

  if (
    acceptedRoleId &&
    !staffRoleIds.includes(
      acceptedRoleId
    )
  ) {
    staffRoleIds.push(
      acceptedRoleId
    );
  }

  return {
    staffRoleIds,
    acceptedRoleId
  };
}

async function getStaffConfig(
  serverId
) {
  const roles =
    await getRoles(
      serverId
    );

  const existing =
    applicationData
      .staffConfig?.[
        serverId
      ];

  if (!existing) {
    const fresh =
      await buildDefaultStaffConfig(
        serverId
      );

    applicationData
      .staffConfig[
        serverId
      ] = fresh;

    saveApplicationData();

    return fresh;
  }

  const validRoleIds =
    new Set(
      roles.map(
        role =>
          String(
            role.id
          )
      )
    );

  const staffRoleIds =
    Array.isArray(
      existing.staffRoleIds
    )
      ? existing.staffRoleIds
          .map(String)
          .filter(
            id =>
              validRoleIds.has(
                id
              )
          )
      : [];

  let acceptedRoleId =
    existing.acceptedRoleId
      ? String(
          existing
            .acceptedRoleId
        )
      : null;

  if (
    acceptedRoleId &&
    !validRoleIds.has(
      acceptedRoleId
    )
  ) {
    acceptedRoleId =
      null;
  }

  if (
    acceptedRoleId &&
    !staffRoleIds.includes(
      acceptedRoleId
    )
  ) {
    staffRoleIds.push(
      acceptedRoleId
    );
  }

  const cleaned = {
    staffRoleIds,
    acceptedRoleId
  };

  applicationData
    .staffConfig[
      serverId
    ] = cleaned;

  saveApplicationData();

  return cleaned;
}

async function getStaffRoleIds(
  serverId
) {
  return (
    await getStaffConfig(
      serverId
    )
  ).staffRoleIds.map(
    String
  );
}

async function getAcceptedRole(
  serverId
) {
  const config =
    await getStaffConfig(
      serverId
    );

  if (
    !config.acceptedRoleId
  ) {
    return null;
  }

  const roles =
    await getRoles(
      serverId
    );

  return findRoleById(
    roles,
    config.acceptedRoleId
  );
}

async function getBotRoleIds(
  serverId
) {
  const ids =
    new Set();

  try {
    const botMember =
      await bot.member(
        serverId,
        bot.me.id
      );

    for (
      const id
      of memberRoleIds(
        botMember
      )
    ) {
      ids.add(
        String(id)
      );
    }
  } catch (err) {
    console.error(
      '[applications] could not read bot member roles:',
      err.message
    );
  }

  if (
    ids.size === 0
  ) {
    try {
      const roles =
        await getRoles(
          serverId
        );

      const fallback =
        findRoleByName(
          roles,
          FALLBACK_BOT_ROLE_NAME
        );

      if (fallback) {
        ids.add(
          String(
            fallback.id
          )
        );
      }
    } catch {}
  }

  return [
    ...ids
  ];
}

async function userHasStaffRole(
  serverId,
  userId
) {
  try {
    const [
      member,
      roles,
      config,
      server
    ] =
      await Promise.all([
        bot.member(
          serverId,
          userId
        ),

        getRoles(
          serverId
        ),

        getStaffConfig(
          serverId
        ),

        getServerObject(
          serverId
        )
      ]);

    if (
      serverOwnerIds(
        server
      ).includes(
        String(
          userId
        )
      )
    ) {
      return true;
    }

    if (
      member
        ?.administrator ===
        true ||
      member?.admin ===
        true ||
      member
        ?.permissions
        ?.includes?.(
          'administrator'
        ) ||
      member
        ?.permissions
        ?.includes?.(
          'admin'
        )
    ) {
      return true;
    }

    const ids =
      memberRoleIds(
        member
      );

    if (
      config.staffRoleIds
        .some(
          roleId =>
            ids.has(
              String(
                roleId
              )
            )
        )
    ) {
      return true;
    }

    const configuredNames =
      new Set(
        config.staffRoleIds
          .map(
            roleId =>
              findRoleById(
                roles,
                roleId
              )?.name
          )
          .filter(Boolean)
          .map(
            name =>
              name.toLowerCase()
          )
      );

    const names =
      memberRoleNames(
        member
      );

    return [
      ...configuredNames
    ].some(
      name =>
        names.has(
          name
        )
    );
  } catch (err) {
    console.error(
      '[staff check] failed:',
      err.message
    );

    return false;
  }
}

// ============================================================
// APPLICATION SETUP CONFIG
// ============================================================

async function getSetupConfig(
  serverId
) {
  const roles =
    await getRoles(
      serverId
    );

  const validRoleIds =
    new Set(
      roles.map(
        role =>
          String(
            role.id
          )
      )
    );

  const existing =
    applicationData
      .setupConfig?.[
        serverId
      ] || {};

  let appRoleIds =
    Array.isArray(
      existing.appRoleIds
    )
      ? existing.appRoleIds
          .map(String)
          .filter(
            id =>
              validRoleIds.has(
                id
              )
          )
      : [];

  if (
    appRoleIds.length ===
    0
  ) {
    appRoleIds =
      DEFAULT_APP_ROLE_NAMES
        .map(
          name =>
            findRoleByName(
              roles,
              name
            )?.id
        )
        .filter(Boolean)
        .map(String);
  }

  appRoleIds = [
    ...new Set(
      appRoleIds
    )
  ].slice(
    0,
    10
  );

  let questions =
    Array.isArray(
      existing.questions
    ) &&
    existing.questions.length >
      0
      ? existing.questions
          .map(
            q =>
              String(
                q || ''
              ).trim()
          )
          .filter(Boolean)
          .slice(
            0,
            10
          )
      : [
          ...DEFAULT_QUESTIONS
        ];

  if (
    questions.length ===
    0
  ) {
    questions = [
      ...DEFAULT_QUESTIONS
    ];
  }

  const cleaned = {
    appRoleIds,
    questions
  };

  applicationData
    .setupConfig[
      serverId
    ] = cleaned;

  saveApplicationData();

  return cleaned;
}

async function getConfiguredAppRoles(
  serverId
) {
  const roles =
    await getRoles(
      serverId
    );

  const config =
    await getSetupConfig(
      serverId
    );

  return config.appRoleIds
    .map(
      id =>
        findRoleById(
          roles,
          id
        )
    )
    .filter(Boolean);
}

async function getApplicationQuestions(
  serverId
) {
  return [
    ...(
      await getSetupConfig(
        serverId
      )
    ).questions
  ];
}

async function saveApplicationRoleIds(
  serverId,
  roleIds
) {
  const config =
    await getSetupConfig(
      serverId
    );

  config.appRoleIds = [
    ...new Set(
      roleIds.map(
        String
      )
    )
  ].slice(
    0,
    10
  );

  applicationData
    .setupConfig[
      serverId
    ] = config;

  saveApplicationData();
}

async function saveQuestions(
  serverId,
  questions
) {
  const config =
    await getSetupConfig(
      serverId
    );

  config.questions =
    questions
      .map(
        q =>
          String(
            q || ''
          ).trim()
      )
      .filter(Boolean)
      .slice(
        0,
        10
      );

  if (
    config.questions.length ===
    0
  ) {
    config.questions = [
      ...DEFAULT_QUESTIONS
    ];
  }

  applicationData
    .setupConfig[
      serverId
    ] = config;

  saveApplicationData();
}

async function getSetupStatus(
  serverId
) {
  const [
    panelChannel,
    appRoles,
    staffConfig,
    roles,
    questions
  ] =
    await Promise.all([
      getPanelChannel(
        serverId
      ),

      getConfiguredAppRoles(
        serverId
      ),

      getStaffConfig(
        serverId
      ),

      getRoles(
        serverId
      ),

      getApplicationQuestions(
        serverId
      )
    ]);

  const acceptedRole =
    staffConfig
      .acceptedRoleId
      ? findRoleById(
          roles,
          staffConfig
            .acceptedRoleId
        )
      : null;

  const staffRoles =
    staffConfig
      .staffRoleIds
      .map(
        id =>
          findRoleById(
            roles,
            id
          )
      )
      .filter(Boolean);

  return {
    panelChannel,
    appRoles,
    staffRoles,
    acceptedRole,
    questions,

    ready:
      !!panelChannel &&
      appRoles.length ===
        10 &&
      staffRoles.length >
        0 &&
      !!acceptedRole &&
      questions.length >
        0
  };
}

// ============================================================
// CATEGORIES
// ============================================================

async function getOrCreateApplicationCategory(
  serverId
) {
  const categories =
    await bot.categories(
      serverId
    );

  let category =
    categories.find(
      item =>
        String(
          item.name || ''
        ).toLowerCase() ===
        APPLICATION_CATEGORY_NAME
          .toLowerCase()
    );

  if (!category) {
    category =
      await bot.createCategory(
        serverId,
        APPLICATION_CATEGORY_NAME
      );
  }

  return category;
}

async function getOrCreateQOTDCategory(
  serverId
) {
  const categories =
    await bot.categories(
      serverId
    );

  let category =
    categories.find(
      item =>
        String(
          item.name || ''
        ).toLowerCase() ===
        'qotd'
    );

  if (!category) {
    category =
      await bot.createCategory(
        serverId,
        'QOTD'
      );
  }

  return category;
}

// ============================================================
// WIKI
// ============================================================

function cleanHTML(
  html = ''
) {
  return html
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ''
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ''
    )
    .replace(
      /<sup[\s\S]*?<\/sup>/gi,
      ''
    )
    .replace(
      /<table[\s\S]*?<\/table>/gi,
      ''
    )
    .replace(
      /<[^>]+>/g,
      ' '
    )
    .replace(
      /&nbsp;|&#160;/g,
      ' '
    )
    .replace(
      /&amp;/g,
      '&'
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;|&apos;/g,
      "'"
    )
    .replace(
      /&lt;/g,
      '<'
    )
    .replace(
      /&gt;/g,
      '>'
    )
    .replace(
      /\[\d+\]/g,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function splitIntoFacts(
  text
) {
  return text
    .split(
      /(?<=[.!?])\s+/
    )
    .map(
      item =>
        item.trim()
    )
    .filter(
      item =>
        item.length >=
          45 &&
        item.length <=
          280 &&
        !/^contents\b/i
          .test(
            item
          ) &&
        !/^navigation\b/i
          .test(
            item
          ) &&
        !/references/i
          .test(
            item
          )
    );
}

function wikiURL(
  title
) {
  return (
    WIKI_BASE +
    encodeURIComponent(
      title.replaceAll(
        ' ',
        '_'
      )
    )
  );
}

async function searchWiki(
  query
) {
  const params =
    new URLSearchParams({
      action:
        'query',

      list:
        'search',

      srsearch:
        query,

      srlimit:
        '5',

      format:
        'json',

      origin:
        '*'
    });

  const res =
    await fetch(
      `${WIKI_API}?${params}`,
      {
        headers: {
          'user-agent':
            'Frieren-Yapper-Bot/1.0'
        }
      }
    );

  if (!res.ok) {
    throw new Error(
      `Wiki search failed: ${res.status}`
    );
  }

  const data =
    await res.json();

  return (
    data?.query?.search ||
    []
  );
}

async function getWikiPage(
  title
) {
  const params =
    new URLSearchParams({
      action:
        'parse',

      page:
        title,

      prop:
        'text|displaytitle',

      redirects:
        '1',

      format:
        'json',

      origin:
        '*'
    });

  const res =
    await fetch(
      `${WIKI_API}?${params}`,
      {
        headers: {
          'user-agent':
            'Frieren-Yapper-Bot/1.0'
        }
      }
    );

  if (!res.ok) {
    throw new Error(
      `Wiki page failed: ${res.status}`
    );
  }

  const data =
    await res.json();

  if (
    data.error ||
    !data.parse
  ) {
    return null;
  }

  return {
    title:
      cleanHTML(
        data.parse
          .displaytitle ||
        title
      ),

    text:
      cleanHTML(
        data.parse
          .text?.['*'] ||
        ''
      )
  };
}

async function findWikiPage(
  query
) {
  const results =
    await searchWiki(
      query
    );

  if (
    !results.length
  ) {
    return null;
  }

  const exact =
    results.find(
      result =>
        result.title
          .toLowerCase() ===
        query
          .toLowerCase()
    );

  return getWikiPage(
    exact?.title ||
    results[0].title
  );
}

// ============================================================
// QOTD
// ============================================================

const QOTD = [
  'Who is your favorite character and why?',
  'What is your favorite arc so far?',
  'Which spell would you want to have in real life?',
  'Who is the most underrated character?',
  'What is your favorite Frieren fight?',
  'Anime, manga, or both?',
  'Who has the best character design?',
  'Which character deserves more screen time?',
  'What scene hit you the hardest?',
  'Who is your favorite mage besides Frieren?',
  'Which member of the party would you want to travel with?',
  'What is the funniest moment in the series?',
  'Which character had the best introduction?',
  'What is your favorite episode?',
  'What is your favorite manga chapter?',
  'Who do you think understands Frieren the best?',
  'Which demon is your favorite?',
  'Who would you trust most in a dungeon?',
  'What location in Frieren would you want to visit?',
  'What spell from the series is the most useful?',
  'What moment made you start loving the series?',
  'Who has had the biggest influence on Frieren?',
  'Favorite member of the original Hero Party?',
  'Favorite member of Frieren’s current party?',
  'Which character has developed the most?',
  'What is your favorite anime opening or ending?',
  'Who would win a mage free-for-all?',
  'What is one character you completely changed your opinion on?',
  'What is your favorite quiet moment in the series?',
  'Which character do you want a backstory chapter for?'
];

function stringHash(
  str
) {
  let hash =
    0;

  for (
    let i = 0;
    i < str.length;
    i++
  ) {
    hash =
      (
        (
          hash <<
          5
        ) -
        hash
      ) +
      str.charCodeAt(
        i
      );

    hash |=
      0;
  }

  return Math.abs(
    hash
  );
}

function todaysQuestion() {
  const date =
    new Date()
      .toLocaleDateString(
        'en-CA',
        {
          timeZone:
            'America/New_York'
        }
      );

  return QOTD[
    stringHash(
      date
    ) %
    QOTD.length
  ];
}

// ============================================================
// APPLICATION HELPERS
// ============================================================

function activeApplicationKey(
  serverId,
  userId
) {
  return `${serverId}:${userId}`;
}

function getActiveApplicationByChannel(
  channelId
) {
  return (
    Object.values(
      applicationData.active
    )
      .find(
        app =>
          String(
            app.channelId
          ) ===
          String(
            channelId
          )
      ) ||
    null
  );
}

function getActiveApplicationForUser(
  serverId,
  userId
) {
  return (
    Object.values(
      applicationData.active
    )
      .find(
        app =>
          String(
            app.serverId
          ) ===
            String(
              serverId
            ) &&
          String(
            app.userId
          ) ===
            String(
              userId
            )
      ) ||
    null
  );
}

function removeActiveApplicationRecord(
  record
) {
  for (
    const [
      key,
      app
    ]
    of Object.entries(
      applicationData.active
    )
  ) {
    if (
      String(
        app.serverId
      ) ===
        String(
          record.serverId
        ) &&
      String(
        app.userId
      ) ===
        String(
          record.userId
        ) &&
      String(
        app.channelId
      ) ===
        String(
          record.channelId
        )
    ) {
      delete applicationData
        .active[
          key
        ];
    }
  }
}

function userIsQueued(
  serverId,
  userId
) {
  return (
    applicationData.queue
      .some(
        item =>
          String(
            item.serverId
          ) ===
            String(
              serverId
            ) &&
          String(
            item.userId
          ) ===
            String(
              userId
            )
      )
  );
}

function getUsedRoleIds(
  serverId
) {
  return new Set(
    Object.values(
      applicationData.active
    )
      .filter(
        app =>
          String(
            app.serverId
          ) ===
          String(
            serverId
          )
      )
      .map(
        app =>
          String(
            app.roleId
          )
      )
  );
}

async function findFreeApplicationRole(
  serverId
) {
  const configuredRoles =
    await getConfiguredAppRoles(
      serverId
    );

  const usedRoleIds =
    getUsedRoleIds(
      serverId
    );

  return (
    configuredRoles.find(
      role =>
        !usedRoleIds.has(
          String(
            role.id
          )
        )
    ) ||
    null
  );
}

function formatApplicationQuestions(
  questions
) {
  return (
    questions
      .map(
        (
          question,
          index
        ) =>
          `**${index + 1}. ${question}**`
      )
      .join(
        '\n\n'
      ) +
    `\n\nPlease number your answers **1–${questions.length}**.`
  );
}

// ============================================================
// CREATE APPLICATION
// ============================================================

async function makePrivateApplicationChannel({
  serverId,
  userId,
  username,
  appRole
}) {
  const category =
    await getOrCreateApplicationCategory(
      serverId
    );

  const staffRoleIds =
    await getStaffRoleIds(
      serverId
    );

  const botRoleIds =
    await getBotRoleIds(
      serverId
    );

  const allowedRoleIds = [
    ...new Set([
      ...staffRoleIds,
      ...botRoleIds,
      String(
        appRole.id
      )
    ])
  ];

  const channel =
    await bot.createChannel(
      serverId,
      `application-${safeChannelName(
        username
      )}`,
      {
        kind:
          'text',

        categoryId:
          category.id
      }
    );

  console.log(
    `[applications] created channel ${channel.id} for ${username}`
  );

  let roleGiven =
    false;

  try {
    await bot.addRole(
      serverId,
      userId,
      appRole.id
    );

    roleGiven =
      true;

    console.log(
      `[applications] gave ${appRole.name} to ${username}`
    );

    await wait(
      1000
    );

    await retry404(
      'channel permission setup',
      () =>
        bot.editChannel(
          channel.id,
          {
            private:
              true,

            roleIds:
              allowedRoleIds
          }
        )
    );

    console.log(
      `[applications] private permissions set for ${channel.id}`
    );

    await wait(
      1200
    );

    const applicationQuestions =
      await getApplicationQuestions(
        serverId
      );

    const questions =
      new Embed()
        .title(
          'Staff Application'
        )
        .description(
`<@${userId}>, please answer these questions in this channel.

${formatApplicationQuestions(
  applicationQuestions
)}`
        )
        .color(
          '#8fbc8f'
        )
        .footer(
          'Staff Application'
        );

    const controls =
      new Row(
        Button.success(
          'Accept',
          `staff:accept:${channel.id}`
        ),

        Button.danger(
          'Reject',
          `staff:reject:${channel.id}`
        ),

        Button.secondary(
          'Close',
          `staff:close:${channel.id}`
        )
      );

    await retry404(
      'question post',
      () =>
        bot.send(
          channel.id,
          `<@${userId}>`,
          {
            embeds:
              [questions],

            components:
              [controls]
          }
        )
    );

    console.log(
      `[applications] questions posted in ${channel.id}`
    );

    const record = {
      userId,
      username,
      serverId,

      channelId:
        channel.id,

      roleId:
        appRole.id,

      roleName:
        appRole.name,

      openedAt:
        new Date()
          .toISOString()
    };

    applicationData.active[
      activeApplicationKey(
        serverId,
        userId
      )
    ] = record;

    applicationData.queue =
      applicationData.queue
        .filter(
          item =>
            !(
              String(
                item.serverId
              ) ===
                String(
                  serverId
                ) &&
              String(
                item.userId
              ) ===
                String(
                  userId
                )
            )
        );

    saveApplicationData();

    return channel;
  } catch (err) {
    console.error(
      '[applications] application creation failed:',
      err.message
    );

    if (
      roleGiven
    ) {
      try {
        await bot.removeRole(
          serverId,
          userId,
          appRole.id
        );
      } catch {}
    }

    for (
      const [
        key,
        app
      ]
      of Object.entries(
        applicationData.active
      )
    ) {
      if (
        String(
          app.serverId
        ) ===
          String(
            serverId
          ) &&
        String(
          app.userId
        ) ===
          String(
            userId
          )
      ) {
        delete applicationData
          .active[
            key
          ];
      }
    }

    saveApplicationData();

    try {
      await bot.deleteChannel(
        channel.id
      );
    } catch {}

    throw err;
  }
}

// ============================================================
// QUEUE
// ============================================================

async function startNextQueuedApplication(
  serverId,
  freedRole = null
) {
  while (
    applicationData
      .queue.length >
    0
  ) {
    const index =
      applicationData.queue
        .findIndex(
          item =>
            String(
              item.serverId
            ) ===
            String(
              serverId
            )
        );

    if (
      index === -1
    ) {
      return;
    }

    const next =
      applicationData
        .queue[
          index
        ];

    try {
      await bot.member(
        serverId,
        next.userId
      );
    } catch {
      applicationData
        .queue
        .splice(
          index,
          1
        );

      saveApplicationData();

      continue;
    }

    const role =
      freedRole ||
      await findFreeApplicationRole(
        serverId
      );

    if (!role) {
      return;
    }

    applicationData
      .queue
      .splice(
        index,
        1
      );

    saveApplicationData();

    try {
      const channel =
        await makePrivateApplicationChannel({
          serverId,

          userId:
            next.userId,

          username:
            next.username,

          appRole:
            role
        });

      try {
        await bot.dmSend(
          next.userId,
          `A staff application slot opened up. Your application is ready: <#${channel.id}>`
        );
      } catch {}

      return;
    } catch (err) {
      console.error(
        '[queue] could not start queued application:',
        err.message
      );

      applicationData
        .queue
        .splice(
          index,
          0,
          next
        );

      saveApplicationData();

      return;
    }
  }
}

async function releaseApplication(
  record,
  {
    deleteChannel = true
  } = {}
) {
  try {
    await bot.removeRole(
      record.serverId,
      record.userId,
      record.roleId
    );
  } catch (err) {
    console.error(
      '[applications] could not remove app role:',
      err.message
    );
  }

  removeActiveApplicationRecord(
    record
  );

  saveApplicationData();

  if (
    deleteChannel
  ) {
    try {
      await bot.deleteChannel(
        record.channelId
      );
    } catch (err) {
      console.error(
        '[applications] could not delete channel:',
        err.message
      );
    }
  }

  const roles =
    await getRoles(
      record.serverId
    );

  const freedRole =
    findRoleById(
      roles,
      record.roleId
    ) ||
    findRoleByName(
      roles,
      record.roleName
    );

  await startNextQueuedApplication(
    record.serverId,
    freedRole
  );
}

async function reconcileApplications() {
  let changed =
    false;

  for (
    const [
      key,
      record
    ]
    of Object.entries(
      applicationData.active
    )
  ) {
    let channel =
      null;

    try {
      channel =
        await bot.channel(
          record.channelId
        );
    } catch {}

    if (!channel) {
      try {
        await bot.removeRole(
          record.serverId,
          record.userId,
          record.roleId
        );
      } catch {}

      delete applicationData
        .active[
          key
        ];

      changed =
        true;
    }
  }

  if (changed) {
    saveApplicationData();
  }
}

// ============================================================
// APPLICATION PANEL
// ============================================================

async function ensureStaffApplicationPanel(
  serverId
) {
  try {
    const panelChannel =
      await getPanelChannel(
        serverId
      );

    if (!panelChannel) {
      console.log(
        `[applications] #${STAFF_PANEL_CHANNEL_NAME} does not exist`
      );

      return false;
    }

    const recentMessages =
      await bot.messages(
        panelChannel.id,
        50
      );

    const panelAlreadyExists =
      recentMessages.some(
        message =>
          message.author_id ===
            bot.me?.id &&
          message.embeds?.some(
            embed =>
              embed.title ===
              'Staff Applications'
          )
      );

    if (
      panelAlreadyExists
    ) {
      console.log(
        '[applications] application panel already exists'
      );

      return true;
    }

    const embed =
      new Embed()
        .title(
          'Staff Applications'
        )
        .description(
`Interested in joining the staff team?

Press the button below to start an application.

If all 10 application slots are being used, you will automatically be placed into the queue.`
        )
        .color(
          '#8fbc8f'
        )
        .footer(
          'Frieren Staff Applications'
        );

    const buttons =
      new Row(
        Button.primary(
          'Apply for Staff',
          'staff_application_open'
        )
      );

    await bot.send(
      panelChannel.id,
      '',
      {
        embeds:
          [embed],

        components:
          [buttons]
      }
    );

    console.log(
      '[applications] application panel created'
    );

    return true;
  } catch (err) {
    console.error(
      '[applications] could not create application panel:',
      err.message
    );

    return false;
  }
}

// ============================================================
// FRIEREN SETUP ROLE PICKER
// ============================================================

const rolePickerSessions =
  new Map();

const ROLE_PICKER_PAGE_SIZE =
  20;

function makeSessionId() {
  return (
    Date.now()
      .toString(
        36
      )
      .slice(
        -6
      ) +
    Math.random()
      .toString(
        36
      )
      .slice(
        2,
        8
      )
  );
}

function cleanupRolePickerSessions() {
  const now =
    Date.now();

  for (
    const [
      id,
      session
    ]
    of rolePickerSessions
      .entries()
  ) {
    if (
      now -
        session.createdAt >
      30 *
        60 *
        1000
    ) {
      rolePickerSessions
        .delete(
          id
        );
    }
  }
}

async function getSelectableApplicationRoles(
  serverId
) {
  const [
    roles,
    staffConfig,
    botRoleIds
  ] =
    await Promise.all([
      getRoles(
        serverId
      ),

      getStaffConfig(
        serverId
      ),

      getBotRoleIds(
        serverId
      )
    ]);

  const excludedIds =
    new Set([
      ...staffConfig
        .staffRoleIds
        .map(String),

      ...botRoleIds
        .map(String),

      staffConfig
        .acceptedRoleId
        ? String(
            staffConfig
              .acceptedRoleId
          )
        : ''
    ]);

  return roles.filter(
    role => {
      const name =
        String(
          role.name || ''
        ).trim();

      const id =
        String(
          role.id
        );

      if (!name) {
        return false;
      }

      if (
        name.toLowerCase() ===
          '@everyone' ||
        name.toLowerCase() ===
          'everyone'
      ) {
        return false;
      }

      if (
        excludedIds.has(
          id
        )
      ) {
        return false;
      }

      return true;
    }
  );
}

function rolePickerView(
  session
) {
  const totalPages =
    Math.max(
      1,
      Math.ceil(
        session.roles.length /
        ROLE_PICKER_PAGE_SIZE
      )
    );

  session.page =
    Math.min(
      Math.max(
        session.page,
        0
      ),
      totalPages - 1
    );

  const start =
    session.page *
    ROLE_PICKER_PAGE_SIZE;

  const pageRoles =
    session.roles.slice(
      start,
      start +
        ROLE_PICKER_PAGE_SIZE
    );

  const rows =
    [];

  for (
    let rowStart = 0;
    rowStart <
      pageRoles.length;
    rowStart += 5
  ) {
    const buttons =
      pageRoles
        .slice(
          rowStart,
          rowStart + 5
        )
        .map(
          role => {
            const selected =
              session.selected.has(
                String(
                  role.id
                )
              );

            const label =
              `${selected ? '✓ ' : ''}${role.name}`
                .slice(
                  0,
                  80
                );

            return selected
              ? Button.success(
                  label,
                  `fsrole:${session.id}:${role.id}`
                )
              : Button.secondary(
                  label,
                  `fsrole:${session.id}:${role.id}`
                );
          }
        );

    rows.push(
      new Row(
        ...buttons
      )
    );
  }

  const controls =
    [];

  if (
    totalPages >
    1
  ) {
    controls.push(
      Button.secondary(
        '← Prev',
        `fsctl:${session.id}:prev`
      )
    );

    controls.push(
      Button.secondary(
        `Page ${session.page + 1}/${totalPages}`,
        `fsctl:${session.id}:noop`
      ).disabled(
        true
      )
    );

    controls.push(
      Button.secondary(
        'Next →',
        `fsctl:${session.id}:next`
      )
    );
  }

  controls.push(
    Button.primary(
      `Save ${session.selected.size}/10`,
      `fsctl:${session.id}:save`
    )
  );

  controls.push(
    Button.danger(
      'Clear',
      `fsctl:${session.id}:clear`
    )
  );

  rows.push(
    new Row(
      ...controls.slice(
        0,
        5
      )
    )
  );

  const selectedNames =
    session.roles
      .filter(
        role =>
          session.selected.has(
            String(
              role.id
            )
          )
      )
      .map(
        role =>
          role.name
      );

  const embed =
    new Embed()
      .title(
        'Choose the 10 Application Roles'
      )
      .description(
`Click the roles Frieren should temporarily assign to applicants.

You must select **exactly 10 roles**.

Selected: **${session.selected.size}/10**

${selectedNames.length
  ? `Current selection:
${selectedNames
  .map(
    name =>
      `• ${name}`
  )
  .join(
    '\n'
  )}`
  : 'No roles selected yet.'}

These should be temporary application-access roles, not moderator/staff roles.`
      )
      .color(
        '#8fbc8f'
      )
      .footer(
        'Frieren Setup'
      );

  return {
    content:
      `<@${session.userId}> application-role setup`,

    embeds:
      [embed],

    components:
      rows
  };
}

async function createRolePicker(
  serverId,
  userId
) {
  cleanupRolePickerSessions();

  const [
    roles,
    config
  ] =
    await Promise.all([
      getSelectableApplicationRoles(
        serverId
      ),

      getSetupConfig(
        serverId
      )
    ]);

  const session = {
    id:
      makeSessionId(),

    serverId:
      String(
        serverId
      ),

    userId:
      String(
        userId
      ),

    roles,

    selected:
      new Set(
        config.appRoleIds
          .filter(
            id =>
              roles.some(
                role =>
                  String(
                    role.id
                  ) ===
                  String(
                    id
                  )
              )
          )
          .map(String)
      ),

    page:
      0,

    createdAt:
      Date.now()
  };

  rolePickerSessions.set(
    session.id,
    session
  );

  return {
    session,
    view:
      rolePickerView(
        session
      )
  };
}

// ============================================================
// SETUP DISPLAY
// ============================================================

async function buildSetupOverview(
  serverId
) {
  const status =
    await getSetupStatus(
      serverId
    );

  const channelLine =
    status.panelChannel
      ? `✅ #${STAFF_PANEL_CHANNEL_NAME} exists`
      : `❌ Create a channel named **#${STAFF_PANEL_CHANNEL_NAME}**`;

  const appRolesLine =
    status.appRoles.length ===
      10
      ? '✅ 10 application roles selected'
      : `❌ Create 10 temporary application roles, then choose them with **/frierensetup roles** (${status.appRoles.length}/10 currently selected)`;

  const staffLine =
    status.staffRoles.length >
      0
      ? `✅ Staff roles configured: ${status.staffRoles
          .map(
            role =>
              role.name
          )
          .join(', ')}`
      : '❌ Configure staff roles with **/staffroles add <role name>**';

  const acceptedLine =
    status.acceptedRole
      ? `✅ Accepted applicants receive: ${status.acceptedRole.name}`
      : '❌ Choose the accepted role with **/staffroles accept <role name>**';

  const questionsLine =
    `✅ ${status.questions.length} application question${status.questions.length === 1 ? '' : 's'} configured`;

  const embed =
    new Embed()
      .title(
        'Frieren Staff Application Setup'
      )
      .description(
`Set up the application system in this order:

**1. Create the applications channel**
Create a text channel named exactly:
**#${STAFF_PANEL_CHANNEL_NAME}**

**2. Create 10 temporary application roles**
They can have any names you want. Applicants receive one of these roles while their application is open.

**3. Choose those 10 roles**
Run **/frierensetup roles** and click exactly 10 roles.

**4. Choose which roles count as staff**
Use **/staffroles** to view or change the staff roles.

**5. Choose the role accepted applicants receive**
Use **/staffroles accept <role name>**.

**6. Edit the application questions**
Use **/frierensetup questions** to view them.
Use **/frierensetup question 1 <new question>** to replace one.
Use **/frierensetup question add <question>** to add one.
Use **/frierensetup question remove <number>** to remove one.
Use **/frierensetup questions reset** to restore the defaults.

**Current setup**
${channelLine}
${appRolesLine}
${staffLine}
${acceptedLine}
${questionsLine}

${status.ready
  ? '✅ **Setup is ready.**'
  : '⚠️ **Setup is not finished yet.**'}`
      )
      .color(
        status.ready
          ? '#57f287'
          : '#8fbc8f'
      )
      .footer(
        'Frieren Setup'
      );

  const controls =
    new Row(
      Button.primary(
        'Choose 10 Roles',
        'frierensetup:startroles'
      ),

      Button.secondary(
        'Refresh Status',
        'frierensetup:status'
      )
    );

  return {
    status,
    embed,
    controls
  };
}

function questionsText(
  questions
) {
  return questions
    .map(
      (
        question,
        index
      ) =>
        `**${index + 1}.** ${question}`
    )
    .join(
      '\n\n'
    );
}

// ============================================================
// COMMANDS
// ============================================================

bot.command(
  'info',
  'Get info about a Frieren character',
  async msg => {
    const query =
      msg.args.trim();

    if (!query) {
      return msg.reply(
        'give me a character name. example: `/info Frieren`'
      );
    }

    try {
      const page =
        await findWikiPage(
          query
        );

      if (!page) {
        return msg.reply(
          `couldn't find anything for **${query}**.`
        );
      }

      const facts =
        splitIntoFacts(
          page.text
        );

      if (
        !facts.length
      ) {
        return msg.reply(
          `found **${page.title}**, but couldn't pull a decent fact.`
        );
      }

      const embed =
        new Embed()
          .title(
            page.title
          )
          .description(
            pickRandom(
              facts
            )
          )
          .url(
            wikiURL(
              page.title
            )
          )
          .color(
            '#8fbc8f'
          )
          .footer(
            'Frieren Wiki'
          );

      return msg.reply(
        '',
        {
          embeds:
            [embed]
        }
      );
    } catch (err) {
      console.error(
        '[info]',
        err
      );

      return msg.reply(
        'wiki is being weird rn. try again in a sec.'
      );
    }
  }
);

bot.command(
  'qotd',
  'Create the Frieren question of the day',
  async msg => {
    try {
      const serverId =
        await getServerId(
          msg
        );

      if (!serverId) {
        return msg.reply(
          "couldn't figure out what server this is in."
        );
      }

      const channels =
        await bot.channels(
          serverId
        );

      const numbers =
        channels
          .map(
            channel =>
              /^qotd-(\d+)$/i
                .exec(
                  channel.name
                )
          )
          .filter(Boolean)
          .map(
            match =>
              Number(
                match[1]
              )
          );

      const nextNumber =
        numbers.length
          ? Math.max(
              ...numbers
            ) + 1
          : 1;

      const category =
        await getOrCreateQOTDCategory(
          serverId
        );

      const channel =
        await bot.createChannel(
          serverId,
          `qotd-${nextNumber}`,
          {
            kind:
              'text',

            categoryId:
              category.id
          }
        );

      await bot.send(
        channel.id,
        `**QOTD #${nextNumber}**\n\n${todaysQuestion()}`
      );

      return msg.reply(
        `made <#${channel.id}>`
      );
    } catch (err) {
      console.error(
        '[qotd]',
        err
      );

      return msg.reply(
        "couldn't make the qotd channel."
      );
    }
  }
);

bot.command(
  'hiatus',
  'Check the Frieren manga hiatus status',
  msg => {
    if (
      !MANGA.hiatus
    ) {
      return msg.reply(
        'the manga is currently publishing.'
      );
    }

    return msg.reply(
      `yeah, still on hiatus.\nlatest chapter: **${MANGA.latestChapter}**\nlast release: **${MANGA.latestRelease}**\nno return date announced yet.`
    );
  }
);

bot.command(
  'nextrelease',
  'Check the next Frieren manga release',
  msg => {
    if (
      !MANGA.nextRelease
    ) {
      return msg.reply(
        `**Chapter ${MANGA.nextChapter}** doesn't have a release date yet. Chapter ${MANGA.latestChapter} is still the latest one.`
      );
    }

    return msg.reply(
      `**Chapter ${MANGA.nextChapter}** is scheduled for **${MANGA.nextRelease}**.`
    );
  }
);

bot.command(
  'latestchapter',
  'Show the latest Frieren manga chapter',
  msg => {
    return msg.reply(
      `latest is **Chapter ${MANGA.latestChapter}**, released ${MANGA.latestRelease}.`
    );
  }
);

// ============================================================
// /STAFFROLES
// ============================================================

bot.command(
  'staffroles',
  'Configure which server roles can manage staff applications',
  async msg => {
    try {
      const serverId =
        await getServerId(
          msg
        );

      const userId =
        getContextUserId(
          msg
        );

      if (!serverId) {
        return msg.reply(
          "couldn't figure out what server this is in."
        );
      }

      if (!userId) {
        return msg.reply(
          "couldn't figure out who ran the command."
        );
      }

      if (
        !(
          await userHasStaffRole(
            serverId,
            userId
          )
        )
      ) {
        return msg.reply(
          'you need to be server staff/admin to change staff roles.'
        );
      }

      const raw =
        String(
          msg.args || ''
        ).trim();

      const [
        subRaw,
        ...rest
      ] =
        raw.split(
          /\s+/
        );

      const sub =
        (
          subRaw ||
          'list'
        ).toLowerCase();

      const roleName =
        rest
          .join(
            ' '
          )
          .trim();

      const roles =
        await getRoles(
          serverId
        );

      const config =
        await getStaffConfig(
          serverId
        );

      const showConfig =
        async () => {
          const freshRoles =
            await getRoles(
              serverId
            );

          const freshConfig =
            await getStaffConfig(
              serverId
            );

          const staffNames =
            freshConfig
              .staffRoleIds
              .map(
                id =>
                  findRoleById(
                    freshRoles,
                    id
                  )?.name
              )
              .filter(Boolean);

          const acceptedRole =
            freshConfig
              .acceptedRoleId
              ? findRoleById(
                  freshRoles,
                  freshConfig
                    .acceptedRoleId
                )
              : null;

          return msg.reply(
`**Staff role settings**

Staff roles: ${staffNames.length
  ? staffNames
      .map(
        name =>
          `**${name}**`
      )
      .join(', ')
  : '*none configured*'}

Accepted applicants receive: ${acceptedRole
  ? `**${acceptedRole.name}**`
  : '*not configured*'}

\`/staffroles add <role name>\`
\`/staffroles remove <role name>\`
\`/staffroles accept <role name>\`
\`/staffroles reset\``
          );
        };

      if (
        sub === 'list' ||
        sub === 'show' ||
        sub === 'help' ||
        !raw
      ) {
        return showConfig();
      }

      if (
        sub === 'reset'
      ) {
        applicationData
          .staffConfig[
            serverId
          ] =
            await buildDefaultStaffConfig(
              serverId
            );

        saveApplicationData();

        await msg.reply(
          'staff roles reset to the default role names that exist in this server.'
        );

        return showConfig();
      }

      if (!roleName) {
        return msg.reply(
          `give me a role name. example: \`/staffroles ${sub} Moderator\``
        );
      }

      const role =
        findRoleByName(
          roles,
          roleName
        );

      if (!role) {
        return msg.reply(
          `i couldn't find a role named **${roleName}**.`
        );
      }

      const roleId =
        String(
          role.id
        );

      if (
        sub === 'add'
      ) {
        if (
          !config
            .staffRoleIds
            .includes(
              roleId
            )
        ) {
          config
            .staffRoleIds
            .push(
              roleId
            );
        }

        applicationData
          .staffConfig[
            serverId
          ] = config;

        saveApplicationData();

        return msg.reply(
          `**${role.name}** can now manage staff applications.`
        );
      }

      if (
        sub === 'remove'
      ) {
        if (
          !config
            .staffRoleIds
            .includes(
              roleId
            )
        ) {
          return msg.reply(
            `**${role.name}** isn't currently a staff application role.`
          );
        }

        if (
          config
            .acceptedRoleId &&
          String(
            config
              .acceptedRoleId
          ) === roleId
        ) {
          return msg.reply(
            `**${role.name}** is currently the role given to accepted applicants. Set a different one first with \`/staffroles accept <role name>\`.`
          );
        }

        config.staffRoleIds =
          config
            .staffRoleIds
            .filter(
              id =>
                String(
                  id
                ) !==
                roleId
            );

        applicationData
          .staffConfig[
            serverId
          ] = config;

        saveApplicationData();

        return msg.reply(
          `**${role.name}** will no longer be treated as staff by the application system.`
        );
      }

      if (
        sub === 'accept'
      ) {
        config.acceptedRoleId =
          roleId;

        if (
          !config
            .staffRoleIds
            .includes(
              roleId
            )
        ) {
          config
            .staffRoleIds
            .push(
              roleId
            );
        }

        applicationData
          .staffConfig[
            serverId
          ] = config;

        saveApplicationData();

        return msg.reply(
          `accepted applicants will now receive **${role.name}**. i also added it to the staff roles.`
        );
      }

      return msg.reply(
        'use `/staffroles`, `/staffroles add <role>`, `/staffroles remove <role>`, `/staffroles accept <role>`, or `/staffroles reset`.'
      );
    } catch (err) {
      console.error(
        '[staffroles]',
        err
      );

      return msg.reply(
        "couldn't update the staff role settings."
      );
    }
  }
);

// ============================================================
// /FRIERENSETUP
// ============================================================

bot.command(
  'frierensetup',
  'Set up Frieren staff applications for this server',
  async msg => {
    try {
      const serverId =
        await getServerId(
          msg
        );

      const userId =
        getContextUserId(
          msg
        );

      if (!serverId) {
        return msg.reply(
          "couldn't figure out what server this is in."
        );
      }

      if (!userId) {
        return msg.reply(
          "couldn't figure out who ran the command."
        );
      }

      if (
        !(
          await userHasStaffRole(
            serverId,
            userId
          )
        )
      ) {
        return msg.reply(
          'server staff/admin only.'
        );
      }

      const raw =
        String(
          msg.args || ''
        ).trim();

      const argv =
        raw
          ? raw.split(
              /\s+/
            )
          : [];

      const sub =
        (
          argv[0] ||
          'overview'
        ).toLowerCase();

      if (
        sub === 'overview' ||
        sub === 'help' ||
        sub === 'status' ||
        !raw
      ) {
        await ensureStaffApplicationPanel(
          serverId
        );

        const overview =
          await buildSetupOverview(
            serverId
          );

        return msg.reply(
          '',
          {
            embeds:
              [
                overview.embed
              ],

            components:
              [
                overview.controls
              ]
          }
        );
      }

      if (
        sub === 'roles' ||
        sub === 'approles'
      ) {
        const {
          view
        } =
          await createRolePicker(
            serverId,
            userId
          );

        return msg.reply(
          view.content,
          {
            embeds:
              view.embeds,

            components:
              view.components
          }
        );
      }

      if (
        sub === 'questions'
      ) {
        const action =
          (
            argv[1] ||
            'show'
          ).toLowerCase();

        if (
          action === 'reset'
        ) {
          await saveQuestions(
            serverId,
            [
              ...DEFAULT_QUESTIONS
            ]
          );

          return msg.reply(
            `questions reset.\n\n${questionsText(
              DEFAULT_QUESTIONS
            )}`
          );
        }

        const questions =
          await getApplicationQuestions(
            serverId
          );

        return msg.reply(
`**Current application questions**

${questionsText(
  questions
)}

To edit one:
\`/frierensetup question 1 Your new question here\`

To add one:
\`/frierensetup question add Your question here\`

To remove one:
\`/frierensetup question remove 3\`

To reset all:
\`/frierensetup questions reset\``
        );
      }

      if (
        sub === 'question'
      ) {
        const action =
          String(
            argv[1] ||
            ''
          ).toLowerCase();

        const questions =
          await getApplicationQuestions(
            serverId
          );

        if (!action) {
          return msg.reply(
            'use `/frierensetup questions` to see and edit the questions.'
          );
        }

        if (
          action === 'add'
        ) {
          const text =
            argv
              .slice(
                2
              )
              .join(
                ' '
              )
              .trim();

          if (!text) {
            return msg.reply(
              'give me the question after `add`.'
            );
          }

          if (
            questions.length >=
            10
          ) {
            return msg.reply(
              'you can have up to 10 application questions.'
            );
          }

          if (
            text.length >
            300
          ) {
            return msg.reply(
              'keep each question under 300 characters.'
            );
          }

          questions.push(
            text
          );

          await saveQuestions(
            serverId,
            questions
          );

          return msg.reply(
            `added question **${questions.length}**:\n${text}`
          );
        }

        if (
          action === 'remove' ||
          action === 'delete'
        ) {
          const number =
            Number(
              argv[2]
            );

          if (
            !Number.isInteger(
              number
            ) ||
            number < 1 ||
            number >
              questions.length
          ) {
            return msg.reply(
              `choose a question number from 1 to ${questions.length}.`
            );
          }

          if (
            questions.length <=
            1
          ) {
            return msg.reply(
              'you need at least one application question.'
            );
          }

          const [
            removed
          ] =
            questions.splice(
              number - 1,
              1
            );

          await saveQuestions(
            serverId,
            questions
          );

          return msg.reply(
            `removed question **${number}**:\n${removed}`
          );
        }

        const number =
          Number(
            action
          );

        if (
          !Number.isInteger(
            number
          ) ||
          number < 1 ||
          number >
            questions.length
        ) {
          return msg.reply(
            `choose a question number from 1 to ${questions.length}, or use \`add\` / \`remove\`.`
          );
        }

        const text =
          argv
            .slice(
              2
            )
            .join(
              ' '
            )
            .trim();

        if (!text) {
          return msg.reply(
            `give me the new text for question ${number}.`
          );
        }

        if (
          text.length >
          300
        ) {
          return msg.reply(
            'keep each question under 300 characters.'
          );
        }

        questions[
          number - 1
        ] = text;

        await saveQuestions(
          serverId,
          questions
        );

        return msg.reply(
          `question **${number}** updated:\n${text}`
        );
      }

      return msg.reply(
        'use `/frierensetup`, `/frierensetup roles`, `/frierensetup questions`, or `/frierensetup question ...`.'
      );
    } catch (err) {
      console.error(
        '[frierensetup]',
        err
      );

      return msg.reply(
        "couldn't open Frieren setup."
      );
    }
  }
);

// ============================================================
// SETUP BUTTONS
// ============================================================

bot.onButton(
  /^frierensetup:(startroles|status)$/,
  async i => {
    const match =
      /^frierensetup:(startroles|status)$/
        .exec(
          i.custom_id
        );

    if (!match) {
      return;
    }

    try {
      await i.ack();

      const serverId =
        await getServerId(
          i
        );

      if (!serverId) {
        return i.ephemeral(
          "couldn't figure out what server this is in."
        );
      }

      if (
        !(
          await userHasStaffRole(
            serverId,
            i.user_id
          )
        )
      ) {
        return i.ephemeral(
          'server staff/admin only.'
        );
      }

      if (
        match[1] ===
        'startroles'
      ) {
        const {
          view
        } =
          await createRolePicker(
            serverId,
            i.user_id
          );

        return i.reply(
          view.content,
          {
            embeds:
              view.embeds,

            components:
              view.components
          }
        );
      }

      await ensureStaffApplicationPanel(
        serverId
      );

      const overview =
        await buildSetupOverview(
          serverId
        );

      return i.reply(
        '',
        {
          embeds:
            [
              overview.embed
            ],

          components:
            [
              overview.controls
            ]
        }
      );
    } catch (err) {
      console.error(
        '[frierensetup button]',
        err
      );

      try {
        return i.ephemeral(
          'setup failed.'
        );
      } catch {}
    }
  }
);

bot.onButton(
  /^fsrole:/,
  async i => {
    const match =
      /^fsrole:([^:]+):(.+)$/
        .exec(
          i.custom_id
        );

    if (!match) {
      return;
    }

    const session =
      rolePickerSessions
        .get(
          match[1]
        );

    const roleId =
      match[2];

    if (!session) {
      return i.ephemeral(
        'this setup menu expired. run `/frierensetup roles` again.'
      );
    }

    if (
      String(
        i.user_id
      ) !==
      String(
        session.userId
      )
    ) {
      return i.ephemeral(
        'this setup menu belongs to someone else.'
      );
    }

    if (
      session.selected.has(
        String(
          roleId
        )
      )
    ) {
      session.selected.delete(
        String(
          roleId
        )
      );
    } else {
      if (
        session.selected.size >=
        10
      ) {
        return i.ephemeral(
          'you already selected 10 roles. unselect one first.'
        );
      }

      session.selected.add(
        String(
          roleId
        )
      );
    }

    const view =
      rolePickerView(
        session
      );

    return i.update({
      content:
        view.content,

      embeds:
        view.embeds,

      components:
        view.components
    });
  }
);

bot.onButton(
  /^fsctl:/,
  async i => {
    const match =
      /^fsctl:([^:]+):(prev|next|save|clear|noop)$/
        .exec(
          i.custom_id
        );

    if (!match) {
      return;
    }

    const sessionId =
      match[1];

    const action =
      match[2];

    const session =
      rolePickerSessions.get(
        sessionId
      );

    if (!session) {
      return i.ephemeral(
        'this setup menu expired. run `/frierensetup roles` again.'
      );
    }

    if (
      String(
        i.user_id
      ) !==
      String(
        session.userId
      )
    ) {
      return i.ephemeral(
        'this setup menu belongs to someone else.'
      );
    }

    if (
      action === 'noop'
    ) {
      return i.ack();
    }

    if (
      action === 'prev'
    ) {
      session.page -=
        1;
    }

    if (
      action === 'next'
    ) {
      session.page +=
        1;
    }

    if (
      action === 'clear'
    ) {
      session.selected
        .clear();
    }

    if (
      action === 'save'
    ) {
      if (
        session.selected.size !==
        10
      ) {
        return i.ephemeral(
          `select exactly 10 roles first. you currently have ${session.selected.size}.`
        );
      }

      await i.ack();

      await saveApplicationRoleIds(
        session.serverId,
        [
          ...session.selected
        ]
      );

      rolePickerSessions.delete(
        sessionId
      );

      await ensureStaffApplicationPanel(
        session.serverId
      );

      const status =
        await getSetupStatus(
          session.serverId
        );

      return i.update({
        content:
          `<@${session.userId}> saved the 10 application roles.`,

        embeds: [
          new Embed()
            .title(
              'Application Roles Saved'
            )
            .description(
`${status.appRoles
  .map(
    role =>
      `• ${role.name}`
  )
  .join(
    '\n'
  )}

${status.ready
  ? '✅ **Frieren staff applications are ready.**'
  : 'The role selection is saved. Run **/frierensetup** to see what is left to finish.'}`
            )
            .color(
              '#57f287'
            )
            .footer(
              'Frieren Setup'
            )
        ],

        components:
          null
      });
    }

    const view =
      rolePickerView(
        session
      );

    return i.update({
      content:
        view.content,

      embeds:
        view.embeds,

      components:
        view.components
    });
  }
);

// ============================================================
// APPLY BUTTON
// ============================================================

bot.onButton(
  'staff_application_open',
  async i => {
    try {
      await i.ack();

      const serverId =
        await getServerId(
          i
        );

      if (!serverId) {
        return i.ephemeral(
          "couldn't figure out what server this is in."
        );
      }

      const status =
        await getSetupStatus(
          serverId
        );

      if (
        status.appRoles.length !==
        10
      ) {
        return i.ephemeral(
          'staff applications are not fully set up yet. a server admin needs to run `/frierensetup`.'
        );
      }

      if (
        !status.acceptedRole ||
        status.staffRoles.length ===
          0
      ) {
        return i.ephemeral(
          'staff applications are not fully set up yet. a server admin needs to configure `/staffroles`.'
        );
      }

      const existing =
        getActiveApplicationForUser(
          serverId,
          i.user_id
        );

      if (existing) {
        return i.ephemeral(
          `you already have an application open: <#${existing.channelId}>`
        );
      }

      if (
        userIsQueued(
          serverId,
          i.user_id
        )
      ) {
        const sameServerQueue =
          applicationData.queue
            .filter(
              item =>
                String(
                  item.serverId
                ) ===
                String(
                  serverId
                )
            );

        const position =
          sameServerQueue
            .findIndex(
              item =>
                String(
                  item.userId
                ) ===
                String(
                  i.user_id
                )
            ) + 1;

        return i.ephemeral(
          `you're already in the application queue. position: **#${position}**`
        );
      }

      const freeRole =
        await findFreeApplicationRole(
          serverId
        );

      if (!freeRole) {
        applicationData.queue.push({
          userId:
            i.user_id,

          username:
            i.username ||
            'applicant',

          serverId,

          joinedAt:
            new Date()
              .toISOString()
        });

        saveApplicationData();

        const sameServerQueue =
          applicationData.queue
            .filter(
              item =>
                String(
                  item.serverId
                ) ===
                String(
                  serverId
                )
            );

        const position =
          sameServerQueue
            .findIndex(
              item =>
                String(
                  item.userId
                ) ===
                String(
                  i.user_id
                )
            ) + 1;

        return i.ephemeral(
          `all application slots are full. you're in the queue at **#${position}**.`
        );
      }

      const channel =
        await makePrivateApplicationChannel({
          serverId,

          userId:
            i.user_id,

          username:
            i.username ||
            'applicant',

          appRole:
            freeRole
        });

      return i.ephemeral(
        `your application is ready: <#${channel.id}>`
      );
    } catch (err) {
      console.error(
        '[staff application open]',
        err
      );

      try {
        return i.ephemeral(
          "couldn't open the application."
        );
      } catch {}
    }
  }
);

// ============================================================
// ACCEPT / REJECT / CLOSE
// ============================================================

bot.onButton(
  /^staff:(accept|reject|close):/,
  async i => {
    const match =
      /^staff:(accept|reject|close):(.+)$/
        .exec(
          i.custom_id
        );

    if (!match) {
      return;
    }

    const action =
      match[1];

    const channelId =
      match[2];

    try {
      await i.ack();

      const record =
        getActiveApplicationByChannel(
          channelId
        );

      if (!record) {
        return i.ephemeral(
          'this application is no longer active.'
        );
      }

      const isStaff =
        await userHasStaffRole(
          record.serverId,
          i.user_id
        );

      const isApplicant =
        String(
          i.user_id
        ) ===
        String(
          record.userId
        );

      if (
        action === 'close'
      ) {
        if (
          !isStaff &&
          !isApplicant
        ) {
          return i.ephemeral(
            'you can only close your own application.'
          );
        }

        await i.ephemeral(
          'closed.'
        );

        await releaseApplication(
          record
        );

        return;
      }

      if (!isStaff) {
        return i.ephemeral(
          'staff only.'
        );
      }

      if (
        action === 'accept'
      ) {
        const acceptedRole =
          await getAcceptedRole(
            record.serverId
          );

        if (!acceptedRole) {
          return i.ephemeral(
            'no accepted-staff role is configured. use `/staffroles accept <role name>` first.'
          );
        }

        await bot.addRole(
          record.serverId,
          record.userId,
          acceptedRole.id
        );

        await i.ephemeral(
          'accepted.'
        );

        try {
          await bot.send(
            record.channelId,
            `<@${record.userId}> accepted. welcome to the team.`
          );
        } catch {}

        await releaseApplication(
          record
        );

        return;
      }

      if (
        action === 'reject'
      ) {
        try {
          await bot.dmSend(
            record.userId,
            'We are sorry to inform you, but you have been rejected.\nYou can always try again.'
          );
        } catch (err) {
          console.error(
            '[reject] could not DM applicant:',
            err.message
          );
        }

        await i.ephemeral(
          'rejected.'
        );

        await releaseApplication(
          record
        );
      }
    } catch (err) {
      console.error(
        `[staff ${action}]`,
        err
      );

      try {
        return i.ephemeral(
          'something went wrong.'
        );
      } catch {}
    }
  }
);

// ============================================================
// HELP
// ============================================================

bot.command(
  'frierenhelp',
  'Show Frieren bot commands',
  msg => {
    return msg.reply(
`**Frieren commands**

\`/info <character>\` — random character info
\`/qotd\` — creates a new QOTD channel
\`/hiatus\` — manga hiatus status
\`/nextrelease\` — next manga chapter
\`/latestchapter\` — latest manga chapter
\`/staffroles\` — configure application staff roles
\`/frierensetup\` — set up the staff application system
\`/frierenhelp\` — this`
    );
  }
);

// ============================================================
// MENTIONS
// ============================================================

const mentionReplies = [
  'hm?',
  'what',
  'you called?',
  '?',
  'yeah?',
  'try `/frierenhelp`'
];

bot.on(
  'message',
  msg => {
    if (
      !msg.mentioned ||
      msg.command
    ) {
      return;
    }

    msg.reply(
      pickRandom(
        mentionReplies
      )
    );
  }
);

// ============================================================
// START
// ============================================================

bot.on(
  'ready',
  async me => {
    console.log(
      `[frieren] logged in as ${me.username}`
    );

    try {
      await bot.setStatus(
        'online',
        'collecting grimoires'
      );
    } catch (err) {
      console.error(
        '[status]',
        err.message
      );
    }

    try {
      await reconcileApplications();
    } catch (err) {
      console.error(
        '[applications] reconciliation failed:',
        err.message
      );
    }

    try {
      const servers =
        await bot.servers();

      for (
        const server
        of servers
      ) {
        await getStaffConfig(
          server.id
        );

        await getSetupConfig(
          server.id
        );

        await ensureStaffApplicationPanel(
          server.id
        );
      }
    } catch (err) {
      console.error(
        '[applications] startup setup error:',
        err.message
      );
    }
  }
);

bot.on(
  'error',
  err => {
    console.error(
      '[frieren]',
      err
    );
  }
);

bot.start().catch(
  err => {
    console.error(
      '[yapper] could not start:',
      err.message
    );

    process.exit(
      1
    );
  }
);