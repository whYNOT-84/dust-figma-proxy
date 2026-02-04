const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Route principale
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Dust Figma Proxy is running' 
  });
});

// Route proxy
app.post('/api/proxy', async (req, res) => {
  try {
    const { prompt, assistantId } = req.body;

    if (!prompt || !assistantId) {
      return res.status(400).json({ 
        error: 'Missing required fields: prompt and assistantId' 
      });
    }

    const DUST_API_KEY = process.env.DUST_API_KEY;
    const DUST_WORKSPACE_ID = process.env.DUST_WORKSPACE_ID;

    if (!DUST_API_KEY || !DUST_WORKSPACE_ID) {
      return res.status(500).json({ 
        error: 'Server configuration error: missing Dust credentials' 
      });
    }

    console.log('📝 Prompt reçu:', prompt);

    // Créer la conversation
    const createResponse = await fetch(
      `https://dust.tt/api/v1/w/${DUST_WORKSPACE_ID}/assistant/conversations`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DUST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            content: prompt,
            mentions: [],
            context: {
              timezone: "Europe/Paris",
              username: "Figma Plugin User"
            }
          },
          assistantId: assistantId,
          blocking: false,
          title: `Mockup: ${prompt.substring(0, 50)}...`
        })
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ Erreur création:', errorText);
      return res.status(createResponse.status).json({ 
        error: 'Dust API error (create)', 
        details: errorText 
      });
    }

    const createData = await createResponse.json();
    const conversationId = createData.conversation.sId;
    
    console.log('✅ Conversation créée:', conversationId);

    // Polling avec timeout plus long (30 secondes max)
    const maxAttempts = 15;
    const delayBetweenAttempts = 2000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔍 Tentative ${attempt}/${maxAttempts}...`);
      
      await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));

      const getResponse = await fetch(
        `https://dust.tt/api/v1/w/${DUST_WORKSPACE_ID}/assistant/conversations/${conversationId}`,
        {
          headers: {
            'Authorization': `Bearer ${DUST_API_KEY}`
          }
        }
      );

      if (!getResponse.ok) {
        console.log(`⚠️ Erreur récupération tentative ${attempt}`);
        continue;
      }

      const getData = await getResponse.json();
      const allMessages = getData.conversation.content.flat();
      
      const agentMessages = allMessages.filter(msg => 
        msg.type === 'agent_message' && msg.content
      );
      
      console.log(`💬 Tentative ${attempt}: ${agentMessages.length} message(s) agent`);
      
      if (agentMessages.length > 0) {
        const lastAgentMessage = agentMessages[agentMessages.length - 1];
        console.log('✅ Message agent trouvé !');
        console.log('📝 Longueur:', lastAgentMessage.content.length);
        
        return res.status(200).json({
          conversation: {
            ...getData.conversation,
            content: [[lastAgentMessage]]
          }
        });
      }
      
      if (attempt === maxAttempts) {
        console.error('❌ Timeout après', maxAttempts * delayBetweenAttempts / 1000, 'secondes');
        
        return res.status(408).json({ 
          error: 'Timeout: assistant did not respond in time',
          debug: {
            conversationId,
            attempts: maxAttempts,
            conversationUrl: `https://dust.tt/w/${DUST_WORKSPACE_ID}/conversation/${conversationId}`
          }
        });
      }
    }

  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy serveur démarré sur le port ${PORT}`);
});