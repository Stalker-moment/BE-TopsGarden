import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function sendOutput() {
  try {
    const outputs = await prisma.output.findMany({
      include: {
        states: {
          orderBy: { createdAt: "desc" },
          take: 1, // Ambil status terbaru
        },
      },
    });

    //console.log("Outputs fetched:", outputs);

    return outputs;
  } catch (error) {
    console.error("Error fetching outputs:", error);
    throw error;
  }
}

export default sendOutput;
