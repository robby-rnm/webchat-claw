#!/bin/bash
# Script to help configure AClient with OpenClaw

echo "🔧 AClient Setup Script"
echo "======================"
echo ""

# Check if OpenClaw is running
echo "1. Checking if OpenClaw Gateway is running..."
if curl -s --connect-timeout 2 "${OPENCLAW_URL:-http://localhost:3000}/health" > /dev/null 2>&1; then
    echo "   ✅ OpenClaw Gateway is running"
else
    echo "   ⚠️  OpenClaw Gateway may not be running"
    echo "   Start it with: openclaw start"
fi
echo ""

# Get API key from config
echo "2. Checking for API keys in OpenClaw config..."
KEYS=$(openclaw config show 2>/dev/null | grep -E "^\s+[a-zA-Z0-9_-]+:\s*|" | head -10)
if [ -n "$KEYS" ]; then
    echo "   Found keys:"
    echo "$KEYS" | sed 's/^/      /'
else
    echo "   No keys found or OpenClaw not accessible"
    echo "   Run: openclaw config edit"
fi
echo ""

# Create .env file
echo "3. Creating .env file..."
if [ -f ".env" ]; then
    echo "   .env already exists"
else
    cp .env.example .env
    echo "   ✅ Created .env from template"
    echo "   ⚠️  Please edit .env and add your API key"
fi
echo ""

echo "🚀 Next steps:"
echo "   1. Edit .env and add your OPENCLAW_API_KEY"
echo "   2. Run: npm install"
echo "   3. Test: npm run http send 'Hello!'"
echo ""
