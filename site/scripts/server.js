const { createApp } = require("../server/app");
const { configFromEnv } = require("../server/config");

const config = configFromEnv();
const { app } = createApp(config);
app.listen(config.port, "0.0.0.0", () => {
  console.log(`Listening on http://0.0.0.0:${config.port}`);
});
