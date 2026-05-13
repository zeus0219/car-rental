#!/bin/bash

# Car Rental Project Deployment Script for Linux + Nginx
# This script deploys the car rental monorepo with Docker and Nginx as a reverse proxy
# 
# Usage: 
#   chmod +x deploy.sh
#   ./deploy.sh
#
# The script will:
#   1. Install Docker, Node.js, pnpm, and Nginx
#   2. Clone/setup the project
#   3. Build Docker images
#   4. Start PostgreSQL, Redis, API, Web, and Worker containers
#   5. Configure Nginx as a reverse proxy
#   6. Setup the database

set -e  # Exit on any error

# ===== CONFIGURE THESE VARIABLES =====
SERVER_IP="${1:-2.24.129.56}"  # Replace with your server's IP address, or pass as argument
JWT_SECRET="$(openssl rand -hex 32)"  # Generates a random 32-char secret
PROJECT_DIR="/var/www/car-rental"
# =====================================

echo "🚀 Starting Car Rental Project Deployment"
echo "Server IP: $SERVER_IP"
echo "Project Directory: $PROJECT_DIR"
echo ""

# Step 3: Set Up Environment Variables
echo "⚙️ Setting up environment variables..."
cp apps/api/.env.example apps/api/.env 2>/dev/null || true

cat > apps/api/.env << EOF
DATABASE_URL="postgresql://carrental:carrental@localhost:5432/carrental?schema=public"
PORT=3000
NODE_ENV=production
JWT_SECRET="$JWT_SECRET"
CORS_ORIGINS="http://$SERVER_IP"
TRUST_PROXY="true"
EOF

echo "✅ Environment variables configured"
echo ""

# Step 4: Build Docker Images
echo "🏗️ Building Docker images..."
echo "   This may take 5-10 minutes..."
docker build -f deploy/Dockerfile.api -t car-rental-api . --progress=plain
docker build -f deploy/Dockerfile.web -t car-rental-web:latest . \
  --build-arg NEXT_PUBLIC_API_URL="http://$SERVER_IP/api/v1" \
  --progress=plain
docker build -f deploy/Dockerfile.worker -t car-rental-worker . --progress=plain

echo "✅ Docker images built successfully"
echo ""

# Step 5: Stop and Remove Old Containers
echo "🛑 Stopping old containers (if any)..."
docker stop car-rental-api car-rental-web car-rental-worker car-rental-pg car-rental-redis 2>/dev/null || true
docker rm car-rental-api car-rental-web car-rental-worker 2>/dev/null || true

echo "✅ Old containers cleaned up"
echo ""

# Step 6: Run Database and Services
echo "🐳 Starting database containers..."
docker compose up -d postgres redis
sleep 15  # Wait for databases to fully initialize

echo "🚀 Starting application containers..."
docker run -d --name car-rental-api \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://carrental:carrental@localhost:5432/carrental?schema=public" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e CORS_ORIGINS="http://$SERVER_IP" \
  -e TRUST_PROXY="true" \
  -e NODE_ENV="production" \
  --network host \
  car-rental-api

docker run -d --name car-rental-web \
  -p 3001:3001 \
  -e NEXT_PUBLIC_API_URL="http://$SERVER_IP/api/v1" \
  --network host \
  car-rental-web:latest

docker run -d --name car-rental-worker \
  -e DATABASE_URL="postgresql://carrental:carrental@localhost:5432/carrental?schema=public" \
  --network host \
  car-rental-worker

echo "✅ Application containers started"
echo ""

# Step 7: Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
sleep 10
for i in {1..30}; do
  if curl -s http://127.0.0.1:3000/v1/health > /dev/null 2>&1; then
    echo "✅ API is ready"
    break
  fi
  echo "   Attempt $i/30 - waiting for API..."
  sleep 2
done

echo ""

# Step 8: Configure Nginx
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/car-rental > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;  # Listen on any server name

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (if needed later)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Web app proxy (catch-all)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Next.js static assets caching
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:3000/v1/health;
        access_log off;
    }
}
EOF

# Remove default site and enable car-rental
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/car-rental /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Nginx configured and restarted"
echo ""

# Step 9: Database Setup
echo "🗄️ Setting up database..."
sleep 5
docker exec car-rental-api npx prisma db push --skip-generate
docker exec car-rental-api npx prisma db seed

echo "✅ Database setup complete"
echo ""

# Step 10: Firewall
echo "🔒 Configuring firewall..."
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw enable || true

echo "✅ Firewall configured"
echo ""

# Success Message
echo "════════════════════════════════════════════════════════════════"
echo "✅ Deployment complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🌟 Access your application:"
echo ""
echo "   Web App: http://$SERVER_IP"
echo "   API Health: http://$SERVER_IP/api/v1/health"
echo "   API Docs: http://$SERVER_IP/api/docs"
echo ""
echo "🔑 Default login credentials:"
echo "   Admin: admin@demo.local / Change-me!23456"
echo "   Agent: agent@demo.local / Change-me!23456"
echo ""
echo "📝 Useful commands:"
echo ""
echo "   View logs:"
echo "     docker logs -f car-rental-api"
echo "     docker logs -f car-rental-web"
echo "     docker logs -f car-rental-worker"
echo ""
echo "   Restart services:"
echo "     docker restart car-rental-api"
echo "     docker restart car-rental-web"
echo "     docker restart car-rental-worker"
echo ""
echo "   Stop all services:"
echo "     docker compose down"
echo ""
echo "   View Nginx logs:"
echo "     sudo tail -f /var/log/nginx/error.log"
echo "     sudo tail -f /var/log/nginx/access.log"
echo ""
echo "🔐 JWT Secret (save this securely):"
echo "   $JWT_SECRET"
echo ""
echo "════════════════════════════════════════════════════════════════"
