import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from '../src/database';
import { api } from '../src/api';

test('database driver rejects unknown adapters and non-Neon endpoints',async()=>{
  const previous=process.env.DATABASE_DRIVER;
  try{
    process.env.DATABASE_DRIVER='unknown';
    assert.throws(()=>database('postgresql://localhost/venue'),/Unsupported DATABASE_DRIVER/);
    process.env.DATABASE_DRIVER='neon';
    assert.throws(()=>database('postgresql://localhost/venue'),/Neon host/);
    assert.throws(()=>database('postgresql://fake.neon.tech.example.com/venue'),/Neon host/);
    const db=database('postgresql://venue_app:unused@ep-test-pooler.neon.tech/venue224');
    await db.pool.end();
  }finally{
    if(previous===undefined)delete process.env.DATABASE_DRIVER;else process.env.DATABASE_DRIVER=previous;
  }
});

test('health stays available without constructing a database connection',async()=>{
  const previous=process.env.DATABASE_DRIVER;
  try{
    process.env.DATABASE_DRIVER='unknown';
    const response=await api(new Request('https://venue.example/api/health'));
    assert.equal(response.status,200);
    assert.equal((await response.json()).service,'224-live-house');
  }finally{
    if(previous===undefined)delete process.env.DATABASE_DRIVER;else process.env.DATABASE_DRIVER=previous;
  }
});
