import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export default async function sendSession(idAccount, idSession) {
  if (!idAccount || !idSession) {
    throw new Error("Both idAccount and idSession are required.");
  }
  if (typeof idAccount !== "string" || typeof idSession !== "string") {
    throw new Error("idAccount and idSession must be strings.");
  }

  try {
    const account = await prisma.account.findUnique({
      where: { id: idAccount },
      include: { contact: true, sessions: true },
    });

    if (!account) {
      throw new Error("Account not found.");
    }

    const { password, role, contact, sessions, ...accountData } = account;
    const accountWithSessionNow = {
      ...accountData,
      sessionNow: idSession,
      contact: contact?.picture
        ? {
            ...contact,
            picture: `${process.env.HOST}/files/img/profile/${contact.picture}`,
          }
        : contact,
    };

    const now = new Date();
    const validSessions = sessions.filter(
      (session) => new Date(session.expiredAt) > now
    );
    const expiredSessionIds = sessions
      .filter((session) => !validSessions.includes(session))
      .map((session) => session.id);

    if (expiredSessionIds.length > 0) {
      await prisma.session.deleteMany({
        where: { id: { in: expiredSessionIds } },
      });
    }

    accountWithSessionNow.sessions = validSessions;

    return { account: accountWithSessionNow };
  } catch (error) {
    console.error("Error in sendSession:", error.message);
    throw error;
  }
}
