const report = require('gatsby-cli/lib/reporter');
const firebase = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const offlineCacheFile = '.cache/offline-firestore.txt';

const getDigest = id =>
  crypto
    .createHash('md5')
    .update(id)
    .digest('hex');

async function loadFromFirestore(boundActionCreators, types, credential) {
  try {
    if (firebase.apps || !firebase.apps.length) {
      firebase.initializeApp({
        credential: firebase.credential.cert(credential),
      });
    }
  } catch (e) {
    report.warn(
      'Could not initialize Firebase. Please check `credential` property in gatsby-config.js'
    );
    report.warn(e);
    return;
  }
  const db = firebase.firestore();
  db.settings({
    timestampsInSnapshots: true,
  });

  const { createNode } = boundActionCreators;

  if (fs.existsSync(offlineCacheFile)) {
    fs.unlinkSync(offlineCacheFile);
  }

  const promises = types.map(
    async ({ collection, type, map = node => node }) => {
      const snapshot = await db.collection(collection).get();
      for (let doc of snapshot.docs) {
        const contentDigest = getDigest(doc.id);
        const docData = Object.assign({}, map(doc.data()), {
          id: doc.id,
          parent: null,
          children: [],
          internal: {
            type,
            contentDigest,
          },
        });

        fs.appendFileSync(offlineCacheFile, JSON.stringify(docData) + '\n');

        const node = createNode(docData);

        Promise.resolve();
      }
    }
  );
  await Promise.all(promises);
}

async function loadFromFile(boundActionCreators, types) {
  const { createNode } = boundActionCreators;

  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(offlineCacheFile),
    terminal: false,
  });
  for await (const line of rl) {
    lines.push(line);
  }

  const promises = types.map(
    async ({ collection, type, map = node => node }, index) => {
      //TODO offline mode currently supports only single collection
      // should persist data with collection name
      // const snapshot = await db.collection(collection).get();
      for (let line of lines) {
        const docData = JSON.parse(line);
        const node = createNode(docData);
        Promise.resolve();
      }
    }
  );
  await Promise.all(promises);
}

exports.sourceNodes = async (
  { boundActionCreators },
  { types, credential }
) => {
  const offlineMode = process.env.OFFLINE_FIRESTORE;
  if (offlineMode) {
    report.warn('Firestore source offline mode is ON!!!');
  }
  const useOfflineFile = offlineMode && fs.existsSync(offlineCacheFile);

  if (useOfflineFile) {
    await loadFromFile(boundActionCreators, types);
  } else {
    await loadFromFirestore(boundActionCreators, types, credential);
  }

  return;
};
