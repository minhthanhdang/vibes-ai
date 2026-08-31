import functions from "@google-cloud/functions-framework";
import { ServiceUsageClient } from "@google-cloud/service-usage";

const PROJECT_ID = process.env.PROJECT_ID ?? "mtd-hackathons";
const SERVICE = "aiplatform.googleapis.com";

functions.cloudEvent("killVertex", async (cloudEvent) => {
  const alert = JSON.parse(
    Buffer.from(cloudEvent.data.message.data, "base64").toString(),
  );
  const { costAmount, budgetAmount, currencyCode, budgetDisplayName } = alert;
  if (costAmount < budgetAmount) {
    console.log(
      `[${budgetDisplayName}] spend ${costAmount} ${currencyCode} < budget ${budgetAmount}, no action`,
    );
    return;
  }
  const client = new ServiceUsageClient();
  const name = `projects/${PROJECT_ID}/services/${SERVICE}`;
  const [service] = await client.getService({ name });
  if (service.state === "DISABLED") {
    console.log(`${SERVICE} already disabled`);
    return;
  }
  const [operation] = await client.disableService({ name });
  await operation.promise();
  console.log(
    `KILL SWITCH FIRED: disabled ${SERVICE} (spend ${costAmount} >= budget ${budgetAmount} ${currencyCode})`,
  );
});
