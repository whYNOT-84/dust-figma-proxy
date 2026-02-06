const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Dust Figma Proxy is running' 
  });
});

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
    console.log('🌊 Utilisation du streaming...');

    // Créer la conversation avec streaming
    const dustResponse = await fetch(
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
          stream: true,
          title: `Mockup: ${prompt.substring(0, 50)}...`
        })
      }
    );

    if (!dustResponse.ok) {
      const errorText = await dustResponse.text();
      console.error('❌ Erreur Dust:', errorText);
      return res.status(dustResponse.status).json({ 
        error: 'Dust API error', 
        details: errorText 
      });
    }

    console.log('✅ Stream ouvert, lecture en cours...');

    // Lire le stream ligne par ligne
    const text = await dustResponse.text();
    const lines = text.split('\n');
    
    let conversationData = null;
    let agentContent = '';
    let lastMessageId = null;

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data: ')) continue;
      
      try {
        const jsonStr = line.substring(6);
        const event = JSON.parse(jsonStr);
        
        console.log('📨 Event type:', event.type);
        
        // Stocker la conversation
        if (event.type === 'user_message_new') {
          conversationData = event.conversation;
        }
        
        // Accumuler le contenu de l'agent
        if (event.type === 'agent_message_new') {
          if (event.message && event.message.content) {
            agentContent += event.message.content;
            lastMessageId = event.message.sId;
          }
        }
        
        // Message final
        if (event.type === 'agent_message_success') {
          if (event.message && event.message.content) {
            agentContent = event.message.content;
            lastMessageId = event.message.sId;
          }
          console.log('✅ Message agent complet reçu');
        }
        
      } catch (e) {
        // Ignorer les lignes invalides
        continue;
      }
    }

    if (!agentContent) {
      console.error('❌ Aucun contenu agent trouvé');
      return res.status(500).json({ 
        error: 'No agent response found',
        debug: { conversationId: conversationData?.sId }
      });
    }

    console.log('📦 Contenu agent longueur:', agentContent.length);
    console.log('📝 Preview:', agentContent.substring(0, 200));

    // Retourner au format attendu par le plugin
    return res.status(200).json({
      conversation: {
        ...conversationData,
        content: [[{
          type: 'agent_message',
          content: agentContent,
          sId: lastMessageId || 'generated',
          visibility: 'visible'
        }]]
      }
    });

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