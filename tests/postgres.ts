import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import type { Pool } from 'pg';
export async function startTestDatabase():Promise<{url?:string;pool?:Pool;stop:()=>Promise<void>}> {
  const url=process.env.TEST_DATABASE_URL;
  if(url) {
    if(!new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL database name must end in _test; tests truncate this dedicated database.');
    return {url,stop:async()=>{}};
  }
  // Embedded PostgreSQL WASM, with transaction-scoped serialization.
  // SQL and constraints are exercised; native multi-backend locking is a CI gate.
  const db=await PGlite.create({extensions:{btree_gist}});
  let tail=Promise.resolve();
  async function connect(){
    let unlock!:()=>void;
    const previous=tail;tail=new Promise<void>(r=>{unlock=r;});
    await previous;
    return {
      async query(sql:string,params?:unknown[]){
        const encoded=params?.map(p=>p instanceof Date?p.toISOString():p!==null&&typeof p==='object'?JSON.stringify(p):p);
        if(!params && sql.includes(';')) {
          const rs=await db.exec(sql);
          return {rows:rs.at(-1)?.rows??[],rowCount:rs.at(-1)?.affectedRows??0};
        }
        const result=await db.query(sql,encoded);
        // node-postgres defaults int8 to strings; PGlite defaults int8 to numbers.
        const rows=result.rows.map((row:any)=>{
          const next={...row};
          for(const field of result.fields) if(field.dataTypeID===20 && next[field.name]!==null) next[field.name]=String(next[field.name]);
          return next;
        });
        return {rows,rowCount:result.affectedRows??rows.length};
      },
      release(){unlock();}
    };
  }
  const pool={
    connect,
    async query(sql:string,params?:unknown[]){const c=await connect();try{return await c.query(sql,params);}finally{c.release();}},
    async end(){}
  } as unknown as Pool;
  console.log('Embedded PostgreSQL functional tests; native PostgreSQL concurrency remains a separate CI gate.');
  return {pool,stop:async()=>{await db.close();}};
}
