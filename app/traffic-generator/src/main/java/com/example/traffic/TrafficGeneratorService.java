package com.example.traffic;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class TrafficGeneratorService {
    private static final Logger logger = LoggerFactory.getLogger(TrafficGeneratorService.class);

    @Autowired
    private RestTemplate restTemplate;

    @Value("${hello.service.url:http://hello:8080}")
    private String helloServiceUrl;

    @Scheduled(fixedRate = 5000) // Every 5 seconds
    public void generateGreetingTraffic() {
        try {
            logger.info("Generating traffic to hello service /api/greeting");
            String response = restTemplate.getForObject(helloServiceUrl + "/api/greeting", String.class);
            logger.info("Traffic generator received greeting response: {}", response);
        } catch (Exception e) {
            logger.error("Error generating greeting traffic", e);
        }
    }

    @Scheduled(fixedRate = 10000) // Every 10 seconds
    public void generateStatusTraffic() {
        try {
            logger.info("Generating traffic to hello service /api/status");
            String response = restTemplate.getForObject(helloServiceUrl + "/api/status", String.class);
            logger.info("Traffic generator received status response: {}", response);
        } catch (Exception e) {
            logger.error("Error generating status traffic", e);
        }
    }
}
