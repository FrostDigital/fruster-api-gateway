pipeline {
    agent {
        label 'linux'
    }

     environment {
        // Define environment variables
        DOCKERHUB_ORG = 'fruster'
        APP_NAME = 'fruster-api-gateway'
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm // Checks out source code from the configured repository
            }
        }

		stage('Build and run test container') {
            steps {
                script {
                    sh "docker build -f Dockerfile.test -t ${APP_NAME}-test ."
					sh "docker run --network host --rm ${APP_NAME}-test"
                }
            }
        }

        stage('Build and Push Docker Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    branch 'master'
					branch 'beta'
                }
            }

            steps {
                script {
                    def gitCommit = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    def branch = env.BRANCH_NAME
                    // Tag will be in the format: develop-20210803120000-abc123
                    def newTag = "${branch}-${new Date().format('yyyyMMddHHmmss')}-${gitCommit}"
                    // Latest branch tag will be in the format: develop-latest
					def latestBranchTag = "${branch}-latest"

                    // Build and push Docker image
                    sh "docker build -t ${DOCKERHUB_ORG}/${APP_NAME}:${newTag} ."
                    sh "docker tag ${DOCKERHUB_ORG}/${APP_NAME}:${newTag} ${DOCKERHUB_ORG}/${APP_NAME}:${latestBranchTag}"

					withCredentials([usernamePassword(credentialsId: 'docker-hub-credentials', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASS')]) {
                        sh "echo ${DOCKERHUB_PASS} | docker login --username ${DOCKERHUB_USER} --password-stdin"
                    }

                    sh "docker push ${DOCKERHUB_ORG}/${APP_NAME}:${newTag}"
                    sh "docker push ${DOCKERHUB_ORG}/${APP_NAME}:${latestBranchTag}"
                }
            }
        }
    }

    post {
        always {
            // Cleanup tasks, such as archiving results, notifications, etc.
            echo "Build completed"
        }
    }
}
