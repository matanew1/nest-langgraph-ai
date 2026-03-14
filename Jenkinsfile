pipeline {
    agent {
        docker {
            image 'node:20-alpine'
            args '-u root'
        }
    }

    environment {
        GROQ_API_KEY    = credentials('groq-api-key')
        TAVILY_API_KEY  = credentials('tavily-api-key')
        REDIS_HOST      = 'localhost'
        REDIS_PORT      = '6379'
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm ci --legacy-peer-deps'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test -- --passWithNoTests'
            }
        }
    }

    post {
        always {
            junit(
                testResults: 'junit.xml',
                allowEmptyResults: true
            )
            cleanWs()
        }
        success {
            echo 'Pipeline passed.'
        }
        failure {
            echo 'Pipeline failed.'
        }
    }
}
