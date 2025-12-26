#!/bin/bash
# Yahoo Mail Extractor - Debian Docker Deployment Script

set -e

echo "=========================================="
echo "Yahoo Mail Extractor - Docker Deployment"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing Docker...${NC}"
    
    # Update package index
    sudo apt-get update
    
    # Install prerequisites
    sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker's official GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    echo -e "${GREEN}Docker installed successfully!${NC}"
    echo -e "${YELLOW}Please log out and log back in for group changes to take effect.${NC}"
fi

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose not found. Please install docker-compose-plugin.${NC}"
    exit 1
fi

echo -e "${GREEN}Docker and Docker Compose are ready.${NC}"

# Create .env file if not exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from .env.example...${NC}"
    cp .env.example .env
fi

# Create data and logs directories
mkdir -p data logs

# Build and start the container
echo -e "${YELLOW}Building and starting the container...${NC}"
docker compose up -d --build

# Wait for the service to be healthy
echo -e "${YELLOW}Waiting for service to be healthy...${NC}"
sleep 5

# Check health
if curl -s http://localhost:8001/health | grep -q "healthy"; then
    echo -e "${GREEN}=========================================="
    echo "Deployment successful!"
    echo "=========================================="
    echo "Service is running at: http://localhost:8001"
    echo ""
    echo "Default login credentials:"
    echo "  Username: admin"
    echo "  Password: nature123"
    echo ""
    echo "Useful commands:"
    echo "  View logs:    docker compose logs -f"
    echo "  Stop:         docker compose down"
    echo "  Restart:      docker compose restart"
    echo -e "==========================================${NC}"
else
    echo -e "${RED}Service health check failed. Check logs with: docker compose logs${NC}"
    exit 1
fi
