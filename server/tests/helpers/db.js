import mongoose from 'mongoose';

// Slow internet? Set TEST_MONGODB_URI to an Atlas URI ending in /sentimart_test (it gets wiped).
export async function connectTestDb() {
  const uri = process.env.TEST_MONGODB_URI;
  if (uri) {
    if (!/\/sentimart_test(\?|$)/.test(uri)) {
      throw new Error('TEST_MONGODB_URI must use the database name sentimart_test (it gets wiped)');
    }
    await mongoose.connect(uri);
    return null;
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  return mongod;
}

export async function closeTestDb(mongod) {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export const initModels = () => Promise.all(Object.values(mongoose.models).map((m) => m.init()));

export const clearDb = () =>
  Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
