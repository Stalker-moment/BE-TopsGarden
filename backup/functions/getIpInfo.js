import axios from "axios";

export default async function getIpInfo(ip) {
    try {
        const response = await axios.get(`http://ipinfo.io/${ip}/json`);
        return response.data;
    } catch (error) {
        console.error("Error fetching IP info:", error);
        throw error;
    }
}
