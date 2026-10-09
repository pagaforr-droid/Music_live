export default async function handler(req, res) {
  const { id } = req.query;
  const token = req.headers.authorization || `Bearer ${process.env.VITE_REPLICATE_API_TOKEN}`;
  
  try {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        "Authorization": token
      }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
