import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig(({mode}) => {
  const values=loadEnv(mode,process.cwd(),'');
  // Server environment only. Never expose DATABASE_URL or tokens through VITE_ variables.
  for(const name of ['DATABASE_URL','APP_ORIGIN','PAYMENT_MODE','ADMIN_API_TOKEN','SANDBOX_WEBHOOK_SECRET'])
    if(values[name] && !process.env[name]) process.env[name]=values[name];
  return {
    plugins:[
      vinext(),
      ...(process.env.CLOUDFLARE_BUILD==='1' ? [cloudflare({
        viteEnvironment: {
          name: "rsc",
          childEnvironments: ["ssr"],
        },
      })] : []),
    ]
  };
});
