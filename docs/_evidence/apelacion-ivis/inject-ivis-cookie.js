async (page) => {
  const fs = require("fs");
  const val = fs
    .readFileSync(
      "C:/Users/mauri/Documents/Trabajos/usalatino-v2/docs/_evidence/apelacion-ivis/ivis-cookie.txt",
      "utf8",
    )
    .trim();
  await page.context().addCookies([
    {
      name: "sb-uexxyokexcamyjcknxua-auth-token",
      value: val,
      domain: "x-legal.usalatinoprime.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return "cookie set len=" + val.length;
}
