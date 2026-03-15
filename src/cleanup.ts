import fs from "fs/promises";
import path from "path";
import db from "./db.js";
import { getUploadDir } from "./api/routes/tickets.js";

const RESOLVED_MAX_AGE_DAYS = 30;

export async function cleanupResolvedTickets() {
  const cutoff = new Date(Date.now() - RESOLVED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const tickets = await db.ticket.findMany({
    where: {
      status: { in: ["RESOLVED", "DUPLICATE"] },
      updatedAt: { lt: cutoff },
    },
    include: { photos: true },
  });

  if (!tickets.length) {
    console.log("[cleanup] Nothing to clean up.");
    return;
  }

  const uploadDir = getUploadDir();
  let deleted = 0;

  for (const ticket of tickets) {
    if (!ticket.photos.length) continue;
    for (const photo of ticket.photos) {
      await fs.unlink(path.join(uploadDir, photo.filename)).catch(() => {});
    }
    await db.ticketPhoto.deleteMany({ where: { ticketId: ticket.id } }).catch(() => {});
    await db.ticket.update({ where: { id: ticket.id }, data: { photosDeleted: true } }).catch(() => {});
    deleted++;
  }

  console.log(`[cleanup] Cleaned photos from ${deleted} resolved/duplicate tickets older than ${RESOLVED_MAX_AGE_DAYS} days.`);
}

export function scheduleWeeklyCleanup() {
  // Run once on startup, then every 7 days
  cleanupResolvedTickets().catch(console.error);
  setInterval(() => cleanupResolvedTickets().catch(console.error), 7 * 24 * 60 * 60 * 1000);
}
