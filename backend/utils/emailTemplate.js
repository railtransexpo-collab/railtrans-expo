// Builds subject, plain-text and HTML email for ticket / e-badge delivery
// Uses provided event copy + badge/banner images. Replace image URLs with
// your hosted asset URLs (or attach images to the mail and use cid: if preferred).
//
// Image references from user:
// - Image 1: top banner (use as `bannerUrl`)
// - Image 2: e-badge preview (use as `badgePreviewUrl`)
//
// Example usage:
// const { subject, text, html, attachments } = buildTicketEmail({
//   frontendBase: "https://app.example.com",
//   entity: "speakers",
//   id: "123",
//   name: "Dr. Vinod Shah",
//   company: "Urban Infra Group",
//   ticket_code: "RTE2600001",
//   ticket_category: "DELEGATE",
//   bannerUrl: "https://cdn.example.com/banner.jpg",      // Image 1
//   badgePreviewUrl: "https://cdn.example.com/badge.jpg", // Image 2 (preview in email)
//   downloadUrl: "https://cdn.example.com/RTE2600001.pdf" // direct PDF link (or signed URL)
// });
//
// Then send with your mailer (and attach the actual PDF as attachment or pass attachments array).
//
// The function returns { subject, text, html, attachments } where `attachments` is optional
// and can include an inline image cid for preview. If you attach the badge PDF as base64,
// include it in mailer attachments separately.

export function buildTicketEmail({
  frontendBase = (typeof window !== "undefined" && window.location ? window.location.origin : "https://railtransexpo.com"),
  entity = "attendee",
  id = "",
  name = "",
  company = "",
  ticket_code = "",
  ticket_category = "",
  bannerUrl = "",       // top banner (Image 1)
  badgePreviewUrl = "", // preview badge (Image 2)
  downloadUrl = "",     // direct link to badge PDF (recommended signed URL)
  upgradeUrl = "",      // self-service upgrade link (if any)
  event = {
    name: "6th RailTrans Expo 2026",
    dates: "03–04 July 2026",
    time: "10:00 AM – 5:00 PM",
    venue: "Halls 12 & 12A, Bharat Mandapam, New Delhi",
  },
}) {
  const frontend = frontendBase.replace(/\/$/, "");
  const manageUrl = `${frontend}/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id))}`;
  const upgradeLink = upgradeUrl || `${frontend}/ticket-upgrade?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id))}&ticket_code=${encodeURIComponent(String(ticket_code))}`;
  const subject = `${event.name || "RailTrans Expo"} – Download Your Registration E-Badge`;

  // Plain-text alternative
  const textLines = [
    `Dear ${name || "Participant"},`,
    "",
    `Thank you for registering for ${event.name || "RailTrans Expo"}.`,
    "",
    `Your Registration Number: ${ticket_code || "N/A"}`,
    downloadUrl ? `Download your E-Badge: ${downloadUrl}` : `Manage your ticket: ${manageUrl}`,
    "",
    "Event Details",
    `Dates: ${event.dates || ""}`,
    `Time: ${event.time || ""}`,
    `Venue: ${event.venue || ""}`,
    "",
    "Important Information & Guidelines:",
    "- Entry permitted only through Gate No. 4 and Gate No. 10.",
    "- Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point.",
    "- The badge is strictly non-transferable and must be worn visibly at all times within the venue.",
    "- Entry is permitted to individuals aged 18 years and above; infants are not permitted.",
    "- All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).",
    "",
    "We look forward to welcoming you at RailTrans Expo 2026.",
    "",
    "Warm regards,",
    "Team RailTrans Expo 2026",
  ];
  const text = textLines.join("\n");

  // HTML email (responsive, simple inline CSS)
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; color: #1f2937; margin: 0; padding: 0; }
      .wrap { max-width: 680px; margin: 0 auto; background: #ffffff; }
      .container { padding: 18px; }
      .banner { width: 100%; height: auto; display:block; border-radius:4px; }
      h1 { font-size: 20px; margin: 12px 0 6px; color: #0b4f60; }
      p { margin: 6px 0; line-height: 1.45; }
      .card { background: #f8fafc; border-radius: 8px; padding: 14px; margin: 12px 0; text-align: center; border: 1px solid #e6eef4;}
      .badge-preview { max-width: 260px; width: 100%; height: auto; display:block; margin: 10px auto; border-radius: 6px; }
      .reg { font-weight:700; letter-spacing: 0.02em; margin-top: 6px; }
      .cta { display:inline-block; margin:10px 6px; padding:12px 18px; background:#c8102e; color:#fff; text-decoration:none; border-radius:6px; font-weight:700; }
      .secondary { background:#196e87; }
      .muted { color:#475569; font-size:13px; }
      ul.guidelines { padding-left: 20px; margin: 8px 0 16px; }
      .footer { font-size: 13px; color: #475569; padding: 14px 0 28px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <img src="${bannerUrl || ""}" alt="${event.name}" class="banner" />
      <div class="container">
        <h1>${subject}</h1>

        <p>Dear ${name || "Participant"},</p>

        <p>Thank you for registering for <strong>${event.name}</strong> – ${event.dates || ""} at ${event.venue || ""}.</p>

        <div class="card">
          <div style="font-size:16px; font-weight:700">${name || ""}</div>
          ${company ? `<div style="margin-top:6px; color:#475569">${company}</div>` : ""}
          ${badgePreviewUrl ? `<img src="${badgePreviewUrl}" alt="E-badge preview" class="badge-preview" />` : ""}
          <div class="reg">Your Registration Number: <span style="color:#0b4f60">${ticket_code || "N/A"}</span></div>
          <div style="margin-top:10px;">
            ${downloadUrl ? `<a href="${downloadUrl}" class="cta">Download E-Badge</a>` : `<a href="${manageUrl}" class="cta">View / Download E-Badge</a>`}
            ${upgradeLink ? `<a href="${upgradeLink}" class="cta secondary">Upgrade Ticket</a>` : ""}
          </div>
        </div>

        <h2 style="font-size:16px; margin-top:8px; color:#0b4f60">Event Details</h2>
        <p class="muted">
          <strong>Dates:</strong> ${event.dates || ""}<br/>
          <strong>Time:</strong> ${event.time || ""}<br/>
          <strong>Venue:</strong> ${event.venue || ""}
        </p>

        <h3 style="font-size:15px; color:#0b4f60; margin-top:8px">Important Information & Guidelines</h3>
        <ul class="guidelines">
          <li>Entry permitted only through Gate No. 4 and Gate No. 10.</li>
          <li>Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.</li>
          <li>The badge is strictly non-transferable and must be worn visibly at all times within the venue.</li>
          <li>Entry is permitted to individuals aged 18 years and above; infants are not permitted.</li>
          <li>All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).</li>
          <li>Security frisking will be carried out at all entry points.</li>
          <li>Paid parking facilities are available at the Bharat Mandapam basement.</li>
        </ul>

        <p>We look forward to welcoming you at RailTrans Expo 2026.</p>

        <p class="footer">
          Warm regards,<br/>
          Team RailTrans Expo 2026
        </p>
      </div>
    </div>
  </body>
</html>
`;

  // attachments array: include badge preview as inline cid if desired
  // By default, return no attachments. Caller may attach the real PDF badge:
  // { filename: 'E-Badge.pdf', content: '<base64>', encoding: 'base64', contentType: 'application/pdf' }
  const attachments = [];
  // Optionally include inline preview image as CID (uncomment if you prefer inline attachments)
  // if (badgePreviewUrl && badgePreviewIsBase64) { attachments.push({ filename: 'badge.jpg', content: '<base64>', encoding: 'base64', contentType: 'image/jpeg', cid: 'badge_preview' }); }
  return { subject, text, html, attachments };
}