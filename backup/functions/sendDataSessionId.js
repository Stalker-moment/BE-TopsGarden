import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function sendDataSessionId(sessionId) {
  try {
    const checkSession = await prisma.session.findMany({
      where: {
        id: sessionId,
      },
    });

    if (checkSession.length === 0) {
      return { error: "Invalid session" };
    }

    return checkSession;
  } catch (error) {
    console.error("Error fetching accounts:", error);
    throw error;
  }
}

export default sendDataSessionId;
